import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { runSync, WhoopError } from '@/lib/whoop';

// Pull recent days from Whoop. A routine refresh re-reads the last ten days —
// Whoop keeps re-scoring a day for a while after it ends, so recent rows are
// rewritten rather than trusted. `days` can be raised for a deeper backfill.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  let days = 10;
  try {
    const body = await req.json();
    if (typeof body?.days === 'number' && body.days > 0) days = Math.min(1095, Math.floor(body.days));
  } catch { /* no body is fine */ }

  try {
    const n = await runSync(ctx.service, ctx.userId, days);
    return NextResponse.json({ ok: true, days: n });
  } catch (e) {
    if (e instanceof WhoopError) {
      const status = e.kind === 'busy' ? 409 : e.kind === 'auth' || e.kind === 'reconnect' ? 401 : 502;
      return NextResponse.json({ error: e.message, kind: e.kind }, { status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 500 });
  }
}
