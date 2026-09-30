import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { getTomsiClientId } from '@/lib/tomsi';
import { fetchGhlAttribution } from '@/lib/ghl-attribution';
import { hasAttribution, type Attribution } from '@/lib/attribution';

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

  // ---- op 3: undo the over-broad relabel for the genuine pre-cutoff intro era ----
  // The one-call switch happened mid-September; bookings before it were real intros
  // and must not read as demos. Named rows keep their original type in raw; the
  // early seeded aggregate rows (no name/contact/appointment id) are restored by an
  // explicit per-day plan supplied in the request.
  if (op === 'restore_early_intros') {
    const DEFAULT_BEFORE = '2026-09-11';
    const DEFAULT_PLAN = [
      { date: '2026-08-03', from: 'sales_call_booked', to: 'intro_booked', count: 3 },
      { date: '2026-08-03', from: 'sales_call_shown',  to: 'intro_shown',  count: 2 },
      { date: '2026-08-10', from: 'sales_call_booked', to: 'intro_booked', count: 6 },
      { date: '2026-08-10', from: 'sales_call_shown',  to: 'intro_shown',  count: 3 },
      { date: '2026-08-17', from: 'sales_call_booked', to: 'intro_booked', count: 4 },
      { date: '2026-08-17', from: 'sales_call_shown',  to: 'intro_shown',  count: 3 },
    ];
    const before = String((body as { before?: string }).before || DEFAULT_BEFORE);
    const plan = ((body as { seed_plan?: { date: string; from: string; to: string; count: number }[] }).seed_plan) || DEFAULT_PLAN;
    const INTRO = ['intro_booked', 'intro_shown'];
    const DEMO = ['sales_call_booked', 'sales_call_shown'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      return NextResponse.json({ error: 'before (YYYY-MM-DD) required' }, { status: 400 });
    }

    const { data: named } = await service
      .from('b2b_events').select('id, occurred_at, lead_name, raw')
      .in('event_type', DEMO).lt('occurred_at', before);
    const namedFix = (named ?? [])
      .map(r => ({ id: r.id, to: (r.raw as { event_type?: string } | null)?.event_type || '', occurred_at: r.occurred_at, lead_name: r.lead_name }))
      .filter(f => INTRO.includes(f.to));

    const seedFix: { id: string; to: string; date: string }[] = [];
    for (const p of plan) {
      if (!DEMO.includes(p.from) || !INTRO.includes(p.to) || p.date >= before) continue;
      const { data: rows } = await service
        .from('b2b_events').select('id').eq('event_type', p.from)
        .is('lead_name', null).is('ghl_contact_id', null).is('external_id', null)
        .gte('occurred_at', p.date + 'T00:00:00').lt('occurred_at', p.date + 'T23:59:59')
        .order('occurred_at', { ascending: true }).limit(Math.max(0, p.count));
      for (const r of rows ?? []) seedFix.push({ id: r.id, to: p.to, date: p.date });
    }

    const all = [...namedFix.map(f => ({ id: f.id, to: f.to })), ...seedFix];
    if (all.length > MAX_CHANGES) {
      return NextResponse.json({ error: `Too many rows (${all.length} > ${MAX_CHANGES}); aborting.` }, { status: 400 });
    }
    if (dryRun) {
      return NextResponse.json({ op, dry_run: true, would_restore: all.length, named: namedFix, seed: seedFix.length });
    }
    let restored = 0;
    for (const f of all) {
      const { error } = await service.from('b2b_events').update({ event_type: f.to }).eq('id', f.id);
      if (error) return NextResponse.json({ error: error.message, restored }, { status: 500 });
      restored++;
    }
    return NextResponse.json({ op, dry_run: false, restored });
  }

  // ---- op 4: one-time reconciliation of the real Sep demo history ----
  // Restores the August intro era to intros (by target counts, so it is safe to
  // re-run) and fills in the demos the tracking missed, from the owner's own
  // record of what happened. Idempotent: new rows key on external_id.
  if (op === 'reconcile_b2b') {
    const AUG = [
      { date: '2026-08-03', to: 'intro_booked', from: 'sales_call_booked', target: 3 },
      { date: '2026-08-03', to: 'intro_shown',  from: 'sales_call_shown',  target: 2 },
      { date: '2026-08-10', to: 'intro_booked', from: 'sales_call_booked', target: 6 },
      { date: '2026-08-10', to: 'intro_shown',  from: 'sales_call_shown',  target: 3 },
      { date: '2026-08-17', to: 'intro_booked', from: 'sales_call_booked', target: 4 },
      { date: '2026-08-17', to: 'intro_shown',  from: 'sales_call_shown',  target: 3 },
    ];
    const reverted: string[] = [];
    for (const a of AUG) {
      const lo = a.date + 'T00:00:00', hi = a.date + 'T23:59:59';
      const { data: have } = await service.from('b2b_events').select('id')
        .eq('event_type', a.to).is('lead_name', null).gte('occurred_at', lo).lt('occurred_at', hi);
      const need = a.target - (have?.length ?? 0);
      if (need > 0) {
        const { data: cand } = await service.from('b2b_events').select('id')
          .eq('event_type', a.from).is('lead_name', null).is('external_id', null)
          .gte('occurred_at', lo).lt('occurred_at', hi).limit(need);
        for (const r of cand ?? []) {
          if (!dryRun) await service.from('b2b_events').update({ event_type: a.to }).eq('id', r.id);
          reverted.push(`${a.date} ${a.to}`);
        }
      }
    }

    // Demos the tracking missed (owner-confirmed). occurred_at at noon UTC.
    // revenue is NOT NULL on b2b_events, so every row must carry it (0 unless a close).
    const NEW = [
      { external_id: 'recon:alexi-booked',   event_type: 'sales_call_booked', occurred_at: '2026-09-12T12:00:00Z', lead_name: 'Alexi Moncada',           lead_email: 'info@usaredwoodrenovation.com', ghl_contact_id: '1zLVGTRWtE3vc3yJwIrr', revenue: 0 },
      { external_id: 'recon:zahra-booked',   event_type: 'sales_call_booked', occurred_at: '2026-09-14T12:00:00Z', lead_name: 'Zahra Cleaning Services', revenue: 0 },
      { external_id: 'recon:thomas-shown',   event_type: 'sales_call_shown',  occurred_at: '2026-09-21T00:06:00Z', lead_name: 'Thomas Cairo',            lead_email: 'tcairo1949@gmail.com',          ghl_contact_id: 'YUktl1kM3oPYAxC2mWVG', revenue: 0 },
      { external_id: 'recon:cathleen-shown', event_type: 'sales_call_shown',  occurred_at: '2026-09-22T19:56:00Z', lead_name: 'Cathleen Miller',         lead_email: 'cathleen@superfloorstoreandremodeling.com', ghl_contact_id: 'zEE8tEmtCRlDJVqcvq8R', revenue: 0 },
      { external_id: 'recon:cathleen-close', event_type: 'close',             occurred_at: '2026-09-22T20:00:00Z', lead_name: 'Cathleen Miller',         lead_email: 'cathleen@superfloorstoreandremodeling.com', ghl_contact_id: 'zEE8tEmtCRlDJVqcvq8R', revenue: 1000 },
    ];
    if (!dryRun) {
      const { error } = await service.from('b2b_events').upsert(NEW, { onConflict: 'external_id' });
      if (error) return NextResponse.json({ error: error.message, reverted }, { status: 500 });
    }
    return NextResponse.json({ op, dry_run: dryRun, reverted_count: reverted.length, reverted, added: NEW.map(n => `${n.lead_name}: ${n.event_type}`) });
  }

  // ---- op 5: mirror the reconciled Sep demos into the Tomsi client events ----
  // The Overview tiles (Demos Booked / Shows / No Shows / Close Rate / Cash) read
  // the client-side `events` mirror, which the B2B webhook fills as bookings
  // arrive. Rows written straight into b2b_events never reached it. This writes
  // each demo in its final state — one row per appointment, as the client-side
  // status flow does — keyed to the same appointment ids so both tables agree.
  // Scoped to the internal Tomsi client only. Idempotent (upsert on external_id).
  if (op === 'mirror_tomsi_demos') {
    const tomsiId = await getTomsiClientId(service);
    if (!tomsiId) return NextResponse.json({ error: 'Internal Tomsi client not found' }, { status: 500 });

    const base = { client_id: tomsiId, revenue: 0 };
    const FINAL = [
      { ...base, event_type: 'show',    external_id: 'recon:alexi-booked',      occurred_at: '2026-09-12T12:00:00Z', lead_name: 'Alexi Moncada',           lead_email: 'info@usaredwoodrenovation.com',            ghl_contact_id: '1zLVGTRWtE3vc3yJwIrr' },
      { ...base, event_type: 'no_show', external_id: 'recon:zahra-booked',      occurred_at: '2026-09-14T12:00:00Z', lead_name: 'Zahra Cleaning Services' },
      { ...base, event_type: 'show',    external_id: 'y1JUtyPEFFRYSaMtdzih',    occurred_at: '2026-09-21T00:05:52Z', lead_name: 'Thomas Cairo',            lead_email: 'tcairo1949@gmail.com',                     ghl_contact_id: 'YUktl1kM3oPYAxC2mWVG' },
      { ...base, event_type: 'no_show', external_id: 'pNM8k9xm7OtshlbEyIoe',    occurred_at: '2026-09-21T04:31:08Z', lead_name: 'Robin Stanley',           lead_email: 'ardscontracting1@gmail.com',               ghl_contact_id: 'zABvHPaaMAZgTVhEVdRs' },
      { ...base, event_type: 'no_show', external_id: '8jSiVJs9fFIYCPbxZzzx',    occurred_at: '2026-09-22T15:15:49Z', lead_name: 'Derick garner',           lead_email: 'derickgarner50@gmail.com',                 ghl_contact_id: 'izf9UeaWw4QkJ2C2YcbQ' },
      { ...base, event_type: 'show',    external_id: 'ESdzczC3ss99FjfMzcQ8',    occurred_at: '2026-09-22T19:55:55Z', lead_name: 'Cathleen Miller',         lead_email: 'cathleen@superfloorstoreandremodeling.com', ghl_contact_id: 'zEE8tEmtCRlDJVqcvq8R' },
      { ...base, event_type: 'no_show', external_id: 'wxJQg5LX0CdlstoEEORQ',    occurred_at: '2026-09-23T10:26:19Z', lead_name: 'Monica',                  lead_email: 'monica@calbayremodeling.com',              ghl_contact_id: 'tWwZ2olVDWVg9JssWbvm' },
      { ...base, event_type: 'no_show', external_id: 'u1E5uJvSmzWcCJicGrsX',    occurred_at: '2026-09-24T18:10:47Z', lead_name: 'Bryan Moore',             lead_email: 'bemoore63@gmail.com',                      ghl_contact_id: 'U2YP3KKUcIYG4OYWFY8Q' },
    ];
    const CLOSES = [
      { ...base, event_type: 'closed', external_id: 'recon:alexi-closed',    occurred_at: '2026-09-14T12:00:00Z', lead_name: 'Alexi Moncada',   lead_email: 'info@usaredwoodrenovation.com',            ghl_contact_id: '1zLVGTRWtE3vc3yJwIrr', revenue: 0 },
      { ...base, event_type: 'closed', external_id: 'recon:cathleen-close',  occurred_at: '2026-09-22T20:00:00Z', lead_name: 'Cathleen Miller', lead_email: 'cathleen@superfloorstoreandremodeling.com', ghl_contact_id: 'zEE8tEmtCRlDJVqcvq8R', revenue: 1000 },
    ];

    // Michael Fischer's booked row already exists in the mirror (no appointment
    // id on it); he showed, so it changes state in place like the status flow.
    const { data: michael } = await service.from('events').select('id')
      .eq('client_id', tomsiId).eq('ghl_contact_id', 'TfZUzBF0WT7RT1L236wP').eq('event_type', 'appointment_booked');
    const michaelFlip = michael?.length ?? 0;

    if (dryRun) {
      return NextResponse.json({ op, dry_run: true, would_flip_michael_to_show: michaelFlip,
        would_write: FINAL.map(r => `${r.lead_name}: ${r.event_type}`), would_write_closes: CLOSES.map(r => `${r.lead_name}: closed $${r.revenue}`) });
    }
    if (michaelFlip) {
      const { error } = await service.from('events').update({ event_type: 'show' })
        .eq('client_id', tomsiId).eq('ghl_contact_id', 'TfZUzBF0WT7RT1L236wP').eq('event_type', 'appointment_booked');
      if (error) return NextResponse.json({ error: error.message, step: 'flip michael' }, { status: 500 });
    }
    const { error: e1 } = await service.from('events').upsert(FINAL, { onConflict: 'external_id' });
    if (e1) return NextResponse.json({ error: e1.message, step: 'demos' }, { status: 500 });
    const { error: e2 } = await service.from('events').upsert(CLOSES, { onConflict: 'external_id' });
    if (e2) return NextResponse.json({ error: e2.message, step: 'closes' }, { status: 500 });
    return NextResponse.json({ op, dry_run: false, flipped_michael: michaelFlip, demos_written: FINAL.length, closes_written: CLOSES.length });
  }

  // ---- op 6: pull ad attribution for B2B contacts from the Tomsi GHL sub-account ----
  // One GHL lookup per unattributed contact, stamped onto that contact's rows in
  // b2b_events and in the Tomsi client mirror (which the campaign table reads).
  // Uses the Tomsi sub-account token; dry-run by default; only fills blanks.
  if (op === 'pull_b2b_attribution') {
    const apiKey = process.env.GHL_API_KEY_B2B;
    if (!apiKey) return NextResponse.json({ error: 'GHL_API_KEY_B2B is not set' }, { status: 503 });
    const tomsiId = await getTomsiClientId(service);
    const limit = Math.min(Number((body as { limit?: number }).limit) || 500, 2000);
    const { data: b2b } = await service.from('b2b_events').select('id, ghl_contact_id')
      .is('campaign_id', null).not('ghl_contact_id', 'is', null).limit(limit);
    const { data: mir } = tomsiId
      ? await service.from('events').select('id, ghl_contact_id').eq('client_id', tomsiId)
          .is('campaign_id', null).not('ghl_contact_id', 'is', null).limit(limit)
      : { data: [] as { id: string; ghl_contact_id: string | null }[] };
    const contacts = [...new Set([...(b2b ?? []), ...(mir ?? [])].map(r => r.ghl_contact_id as string))];
    const attrByContact = new Map<string, Attribution>(); const failed: string[] = [];
    for (const cid of contacts) {
      const res = await fetchGhlAttribution(cid, apiKey);
      if (res.ok && hasAttribution(res.attribution)) attrByContact.set(cid, res.attribution);
      else if (!res.ok) failed.push(`${cid}:${res.status}`);
    }
    const stampable = (rows: { id: string; ghl_contact_id: string | null }[] | null) =>
      (rows ?? []).filter(r => attrByContact.has(r.ghl_contact_id as string));
    const sB2b = stampable(b2b), sMir = stampable(mir);
    if (dryRun) {
      return NextResponse.json({ op, dry_run: true, contacts_checked: contacts.length, contacts_with_attribution: attrByContact.size,
        would_update: { b2b_events: sB2b.length, tomsi_events: sMir.length }, failed });
    }
    let updated = 0;
    for (const r of sB2b) { const { error } = await service.from('b2b_events').update(attrByContact.get(r.ghl_contact_id as string)!).eq('id', r.id); if (!error) updated++; }
    for (const r of sMir) { const { error } = await service.from('events').update(attrByContact.get(r.ghl_contact_id as string)!).eq('id', r.id); if (!error) updated++; }
    return NextResponse.json({ op, dry_run: false, contacts_checked: contacts.length, contacts_with_attribution: attrByContact.size, updated, failed });
  }

  // ---- op 7: tag who booked each Sep demo (owner-confirmed; predates the booked_by field) ----
  // 'team' = we booked it by hand, 'self' = the lead booked through the calendar.
  // Drives Hand-Booked Appointments and Lead Appt Booking Rate. Idempotent.
  if (op === 'set_booked_by') {
    const byExternal: { external_id: string; booked_by: 'team' | 'self'; who: string }[] = [
      { external_id: 'recon:alexi-booked',   booked_by: 'team', who: 'Alexi Moncada' },
      { external_id: 'recon:zahra-booked',   booked_by: 'team', who: 'Zahra Cleaning Services' },
      { external_id: 'y1JUtyPEFFRYSaMtdzih', booked_by: 'team', who: 'Thomas Cairo' },
      { external_id: 'pNM8k9xm7OtshlbEyIoe', booked_by: 'self', who: 'Robin Stanley' },
      { external_id: '8jSiVJs9fFIYCPbxZzzx', booked_by: 'self', who: 'Derick garner' },
      { external_id: 'ESdzczC3ss99FjfMzcQ8', booked_by: 'team', who: 'Cathleen Miller' },
      { external_id: 'wxJQg5LX0CdlstoEEORQ', booked_by: 'team', who: 'Monica' },
      { external_id: 'u1E5uJvSmzWcCJicGrsX', booked_by: 'self', who: 'Bryan Moore' },
    ];
    // Michael Fischer's booking carries no appointment id — match on his contact.
    const michael = { ghl_contact_id: 'TfZUzBF0WT7RT1L236wP', booked_by: 'team' as const, who: 'Michael Fischer' };

    const plan: { who: string; booked_by: string }[] = [];
    for (const r of byExternal) {
      const { data } = await service.from('b2b_events').select('id, booked_by').eq('external_id', r.external_id).eq('event_type', 'sales_call_booked');
      for (const row of data ?? []) if (row.booked_by !== r.booked_by) plan.push({ who: r.who, booked_by: r.booked_by });
    }
    const { data: m } = await service.from('b2b_events').select('id, booked_by').eq('ghl_contact_id', michael.ghl_contact_id).eq('event_type', 'sales_call_booked');
    for (const row of m ?? []) if (row.booked_by !== michael.booked_by) plan.push({ who: michael.who, booked_by: michael.booked_by });

    if (dryRun) return NextResponse.json({ op, dry_run: true, would_tag: plan.length, plan });
    let tagged = 0;
    for (const r of byExternal) {
      const { data } = await service.from('b2b_events').update({ booked_by: r.booked_by }).eq('external_id', r.external_id).eq('event_type', 'sales_call_booked').select('id');
      tagged += data?.length ?? 0;
    }
    const { data: mm } = await service.from('b2b_events').update({ booked_by: michael.booked_by }).eq('ghl_contact_id', michael.ghl_contact_id).eq('event_type', 'sales_call_booked').select('id');
    tagged += mm?.length ?? 0;
    return NextResponse.json({ op, dry_run: false, tagged });
  }

  // ---- op 8: a demo shows once — drop repeated "shown" rows ----
  // GHL re-fired "shown" for demos that were already resolved (show or no-show).
  // b2b_events: a shown row is a repeat when the contact's previous demo row is
  // already shown / had no newer booking. Mirror: a show row is a repeat when the
  // contact already had a show or no-show before it; a show row sitting next to
  // the still-pending booking it belongs to is folded into that booking (flip).
  if (op === 'dedupe_shows') {
    const tomsiId = await getTomsiClientId(service);
    if (!tomsiId) return NextResponse.json({ error: 'Tomsi Media client not found' }, { status: 500 });

    type R = { id: string; event_type: string; ghl_contact_id: string | null; occurred_at: string; lead_name: string | null };
    const byContact = (rows: R[]) => {
      const m = new Map<string, R[]>();
      for (const r of rows) { if (!r.ghl_contact_id) continue; const a = m.get(r.ghl_contact_id) ?? []; a.push(r); m.set(r.ghl_contact_id, a); }
      for (const a of m.values()) a.sort((x, y) => x.occurred_at.localeCompare(y.occurred_at));
      return m;
    };

    const { data: b2b } = await service.from('b2b_events').select('id, event_type, ghl_contact_id, occurred_at, lead_name')
      .in('event_type', ['sales_call_booked', 'sales_call_shown']);
    const b2bDel: { id: string; who: string; at: string }[] = [];
    for (const rows of byContact((b2b ?? []) as R[]).values()) {
      let lastShown = false;
      for (const r of rows) {
        if (r.event_type === 'sales_call_booked') lastShown = false;
        else if (lastShown) b2bDel.push({ id: r.id, who: r.lead_name ?? '?', at: r.occurred_at });
        else lastShown = true;
      }
    }

    const { data: mir } = await service.from('events').select('id, event_type, ghl_contact_id, occurred_at, lead_name')
      .eq('client_id', tomsiId).in('event_type', ['appointment_booked', 'show', 'no_show']);
    const mirDel: { id: string; who: string; at: string }[] = [];
    const mirFlip: { id: string; dropId: string; who: string }[] = [];
    const noShowContacts = new Set<string>();
    for (const [contact, rows] of byContact((mir ?? []) as R[])) {
      let resolved = false; let pending: R | null = null; let state = '';
      for (const r of rows) {
        if (r.event_type === 'appointment_booked') { pending = r; resolved = false; state = 'pending'; }
        else if (r.event_type === 'show' && pending) { mirFlip.push({ id: pending.id, dropId: r.id, who: r.lead_name ?? '?' }); pending = null; resolved = true; state = 'show'; }
        else if (resolved) mirDel.push({ id: r.id, who: r.lead_name ?? '?', at: r.occurred_at });
        else { resolved = true; state = r.event_type; }
      }
      if (state === 'no_show') noShowContacts.add(contact);
    }
    // The ledger says no-show (mirror) but a stray "shown" landed in b2b_events → repeat there too.
    for (const r of (b2b ?? []) as R[]) {
      if (r.event_type === 'sales_call_shown' && r.ghl_contact_id && noShowContacts.has(r.ghl_contact_id) && !b2bDel.some(d => d.id === r.id)) {
        b2bDel.push({ id: r.id, who: `${r.lead_name ?? '?'} (no-show on record)`, at: r.occurred_at });
      }
    }

    const total = b2bDel.length + mirDel.length + mirFlip.length * 2;
    if (total > MAX_CHANGES) return NextResponse.json({ error: `Too many rows (${total} > ${MAX_CHANGES}); aborting for safety.` }, { status: 400 });
    if (dryRun) return NextResponse.json({ op, dry_run: true, would_delete_b2b: b2bDel, would_delete_mirror: mirDel, would_fold_into_booking: mirFlip.map(f => f.who), total });

    for (const f of mirFlip) {
      await service.from('events').update({ event_type: 'show' }).eq('id', f.id);
      await service.from('events').delete().eq('id', f.dropId);
    }
    if (mirDel.length) await service.from('events').delete().in('id', mirDel.map(r => r.id));
    if (b2bDel.length) await service.from('b2b_events').delete().in('id', b2bDel.map(r => r.id));
    return NextResponse.json({ op, dry_run: false, deleted_b2b: b2bDel.length, deleted_mirror: mirDel.length, folded: mirFlip.length });
  }

  // ---- op 9: one mirrored lead per contact ----
  if (op === 'dedupe_mirror_leads') {
    const tomsiId = await getTomsiClientId(service);
    if (!tomsiId) return NextResponse.json({ error: 'Tomsi Media client not found' }, { status: 500 });
    const { data } = await service.from('events').select('id, ghl_contact_id, occurred_at, lead_name')
      .eq('client_id', tomsiId).eq('event_type', 'lead').order('occurred_at', { ascending: true });
    const seen = new Set<string>();
    const del: { id: string; who: string }[] = [];
    for (const r of data ?? []) {
      if (!r.ghl_contact_id) continue;
      if (seen.has(r.ghl_contact_id)) del.push({ id: r.id, who: r.lead_name ?? '?' });
      else seen.add(r.ghl_contact_id);
    }
    if (del.length > MAX_CHANGES) return NextResponse.json({ error: `Too many rows (${del.length} > ${MAX_CHANGES}); aborting for safety.` }, { status: 400 });
    if (dryRun) return NextResponse.json({ op, dry_run: true, would_delete: del });
    if (del.length) await service.from('events').delete().in('id', del.map(r => r.id));
    return NextResponse.json({ op, dry_run: false, deleted: del.length });
  }

  // ---- op 10: leads literally named "test" are fake submissions ----
  if (op === 'mark_test_leads') {
    const tomsiId = await getTomsiClientId(service);
    const isTest = (n: string | null) => /^test\s*$/i.test(String(n ?? '').trim());
    const { data: b2b } = await service.from('b2b_events').select('id, lead_name').eq('event_type', 'lead');
    const b2bIds = (b2b ?? []).filter(r => isTest(r.lead_name)).map(r => r.id);
    const { data: mir } = tomsiId
      ? await service.from('events').select('id, lead_name').eq('client_id', tomsiId).eq('event_type', 'lead')
      : { data: [] as { id: string; lead_name: string | null }[] };
    const mirIds = (mir ?? []).filter(r => isTest(r.lead_name)).map(r => r.id);
    const total = b2bIds.length + mirIds.length;
    if (total > MAX_CHANGES) return NextResponse.json({ error: `Too many rows (${total} > ${MAX_CHANGES}); aborting for safety.` }, { status: 400 });
    if (dryRun) return NextResponse.json({ op, dry_run: true, would_flag_b2b: b2bIds.length, would_flag_mirror: mirIds.length });
    if (b2bIds.length) await service.from('b2b_events').update({ event_type: 'spam_lead' }).in('id', b2bIds);
    if (mirIds.length) await service.from('events').update({ event_type: 'spam_lead' }).in('id', mirIds);
    return NextResponse.json({ op, dry_run: false, flagged_b2b: b2bIds.length, flagged_mirror: mirIds.length });
  }

  return NextResponse.json({ error: `Unknown op. Allowed: relabel_intros_to_demos, dedupe_bookings, restore_early_intros, reconcile_b2b, mirror_tomsi_demos, pull_b2b_attribution, set_booked_by, dedupe_shows, dedupe_mirror_leads, mark_test_leads` }, { status: 400 });
}
