import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { whoopConfigured } from '@/lib/whoop';

const DAY_COLS = 'day, cycle_id, recovery_score, hrv_ms, resting_hr, spo2, skin_temp_c, '
  + 'sleep_hours, nap_hours, sleep_performance, sleep_efficiency, sleep_consistency, respiratory_rate, '
  + 'sleep_stages, strain, kilojoules, avg_hr, max_hr, workouts, scored, synced_at';

// Connection status and the stored days. Tokens never leave the server.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data: conn } = await ctx.service.from('whoop_connections')
    .select('whoop_user_id, connected_at, last_synced_at, sync_started_at, last_error')
    .eq('user_id', ctx.userId).maybeSingle();

  if (!conn) {
    return NextResponse.json({ configured: whoopConfigured(), connected: false, days: [] });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  let q = ctx.service.from('whoop_days').select(DAY_COLS).eq('user_id', ctx.userId);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte('day', from);
  const { data: days, error } = await q.order('day', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    configured: true,
    connected: true,
    connected_at: conn.connected_at,
    last_synced_at: conn.last_synced_at,
    syncing: !!conn.sync_started_at && Date.now() - new Date(conn.sync_started_at).getTime() < 120_000,
    last_error: conn.last_error,
    days: days ?? [],
  });
}

// Disconnect: forget the tokens. The days already pulled are kept — they are
// the user's own history, and reconnecting simply fills in from where it left off.
export async function DELETE() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { error } = await ctx.service.from('whoop_connections').delete().eq('user_id', ctx.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
