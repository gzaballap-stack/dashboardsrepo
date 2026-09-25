import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

/**
 * Guarded data-cleanup endpoint.
 *
 * A deliberately narrow tool: it can ONLY run the named, safe operations below,
 * always previews by default (dry_run defaults to true — nothing changes unless
 * dry_run is explicitly false), caps how much it can touch, and never edits
 * revenue/close rows or client records.
 *
 * POST { op, dry_run?: boolean }
 *   op = 'relabel_intros_to_demos' | 'dedupe_bookings'
 */

const MAX_CHANGES = 200;           // refuse runaway operations
const DEDUPE_WINDOW_MS = 120_000;  // two bookings this close = the same double-fire

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { op?: string; dry_run?: boolean };
  try { body = await req.json(); } catch { body = {}; }
  const op = body.op;
  const dryRun = body.dry_run !== false;
  const service = createServiceClient();

  // ---- op 1: relabel the old "intro" stage as demos (one-call process) ----
  if (op === 'relabel_intros_to_demos') {
    const map: Record<string, string> = {
      intro_booked: 'sales_call_booked',
      intro_shown: 'sales_call_shown',
    };
    const preview: Record<string, number> = {};
    let total = 0;
    for (const from of Object.keys(map)) {
      const { data } = await service.from('b2b_events').select('id').eq('event_type', from);
      preview[from] = data?.length ?? 0;
      total += preview[from];
    }
    if (total > MAX_CHANGES) {
      return NextResponse.json({ error: `Too many rows (${total} > ${MAX_CHANGES}); aborting for safety.` }, { status: 400 });
    }
    if (dryRun) {
      return NextResponse.json({ op, dry_run: true, would_relabel: preview, total });
    }
    const changed: Record<string, number> = {};
    for (const [from, to] of Object.entries(map)) {
      const { data, error } = await service
        .from('b2b_events').update({ event_type: to }).eq('event_type', from).select('id');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      changed[`${from}->${to}`] = data?.length ?? 0;
    }
    return NextResponse.json({ op, dry_run: false, relabeled: changed, total });
  }

  // ---- op 2: remove exact-duplicate bookings that predate ID-based dedupe ----
  if (op === 'dedupe_bookings') {
    // A double-fire leaves two near-simultaneous rows for the same person: one
    // carrying the appointment id, one blank. The id row is canonical; the blank
    // copy is the duplicate. Rule: a row is a duplicate only when another row for
    // the same person + type sits within the window. Never delete a row that
    // carries an appointment id, and never a row with revenue.
    const TYPES = ['sales_call_booked', 'sales_call_shown', 'lead'];
    const { data: rows, error } = await service
      .from('b2b_events')
      .select('id, event_type, occurred_at, lead_name, lead_email, ghl_contact_id, external_id, revenue')
      .in('event_type', TYPES)
      .order('occurred_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const idOf = (r: { ghl_contact_id: string | null; lead_email: string | null; lead_name: string | null }) =>
      r.ghl_contact_id || r.lead_email || (r.lead_name || '').trim().toLowerCase();

    type Row = NonNullable<typeof rows>[number];
    const groups = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const who = idOf(r);
      if (!who || Number(r.revenue) > 0) continue;          // need an identity; never money rows
      const key = r.event_type + '|' + who;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }

    const dupes: { id: string; who: string; event_type: string; occurred_at: string }[] = [];
    for (const [, list] of groups) {
      // cluster rows that fall within the window of the cluster anchor
      let i = 0;
      while (i < list.length) {
        const anchor = new Date(list[i].occurred_at).getTime();
        const cluster = [list[i]];
        let j = i + 1;
        while (j < list.length && new Date(list[j].occurred_at).getTime() - anchor <= DEDUPE_WINDOW_MS) {
          cluster.push(list[j]); j++;
        }
        if (cluster.length > 1) {
          // keep one: prefer the earliest row that carries an appointment id
          const keeper = cluster.find(r => r.external_id) ?? cluster[0];
          for (const r of cluster) {
            if (r.id !== keeper.id && !r.external_id) {
              dupes.push({ id: r.id, who: idOf(r), event_type: r.event_type, occurred_at: r.occurred_at });
            }
          }
        }
        i = j;
      }
    }

    if (dupes.length > MAX_CHANGES) {
      return NextResponse.json({ error: `Too many duplicates (${dupes.length} > ${MAX_CHANGES}); aborting for safety.` }, { status: 400 });
    }
    if (dryRun) {
      return NextResponse.json({ op, dry_run: true, would_delete: dupes.length, rows: dupes });
    }
    if (dupes.length === 0) {
      return NextResponse.json({ op, dry_run: false, deleted: 0 });
    }
    const { data: del, error: de } = await service
      .from('b2b_events').delete().in('id', dupes.map(d => d.id)).select('id');
    if (de) return NextResponse.json({ error: de.message }, { status: 500 });
    return NextResponse.json({ op, dry_run: false, deleted: del?.length ?? 0, rows: dupes });
  }

  return NextResponse.json({ error: `Unknown op. Allowed: relabel_intros_to_demos, dedupe_bookings` }, { status: 400 });
}
