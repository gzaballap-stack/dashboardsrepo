import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { POST as syncClient } from '@/app/api/ad-spend/sync-all/route';
import { POST as syncB2B } from '@/app/api/b2b-ad-spend/sync-all/route';

// Scheduled Meta spend sync for every client with a `meta_account_id`, plus the
// Tomsi Media (B2B) account. Replaces the 13 per-client Make spend scenarios.
// Triggered three times a day by pg_cron on the database (see NOTES.md
// 2026-10-25). Each per-client sync also refreshes today-so-far.
// Body (optional): { date: "YYYY-MM-DD" } — defaults to yesterday.

function yesterday(): string {
  const tz = process.env.REPORT_TIMEZONE ?? 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : yesterday();

  const service = createServiceClient();
  const { data: clients, error } = await service
    .from('clients')
    .select('name, meta_account_id')
    .not('meta_account_id', 'is', null)
    .neq('status', 'offline')
    .eq('is_internal', false);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const call = async (handler: (r: Request) => Promise<Response>, payload: Record<string, unknown>) => {
    const res = await handler(new Request(req.url, {
      method: 'POST',
      headers: { authorization: req.headers.get('authorization') ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, ...(res.ok ? {} : { error: json.error ?? res.status }) };
  };

  // One at a time — keeps well inside Meta's per-app rate limit.
  const results: Record<string, unknown> = {};
  for (const c of clients ?? []) {
    results[c.name] = await call(syncClient, { client_name: c.name, date, platform: 'meta', account_id: c.meta_account_id });
  }
  results['Tomsi Media (B2B)'] = await call(syncB2B, { date, platform: 'meta' });

  const failed = Object.entries(results).filter(([, r]) => !(r as { ok: boolean }).ok);
  if (failed.length) console.warn('[cron/sync-spend] failures', JSON.stringify(Object.fromEntries(failed)));
  return NextResponse.json({ date, synced: Object.keys(results).length - failed.length, failed: failed.length, results });
}
