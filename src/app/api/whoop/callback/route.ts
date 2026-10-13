import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { exchangeCode, expiresAt, fetchProfile, runSync, WhoopError } from '@/lib/whoop';

// Where Whoop sends the browser after approval. The user is still signed in to
// the dashboard (it's the same browser, same cookies), so this is tied to their
// account the ordinary way. On success the tracker opens on the Whoop tab with
// the last three months already pulled in.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return NextResponse.redirect(new URL('/login', req.url));

  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/dashboard?${q}`, req.url));

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');
  if (denied) return back(`whoop=error&reason=${encodeURIComponent(denied)}`);
  if (!code || !state) return back('whoop=error&reason=missing-code');

  // The state cookie was set when the connect flow started.
  const cookie = req.headers.get('cookie') ?? '';
  const expected = /(?:^|;\s*)whoop_state=([^;]+)/.exec(cookie)?.[1];
  if (!expected || expected !== state) return back('whoop=error&reason=state-mismatch');

  try {
    const t = await exchangeCode(req, code);

    let whoopUserId: string | null = null;
    try {
      const p = await fetchProfile(t.access_token);
      whoopUserId = p.user_id != null ? String(p.user_id) : null;
    } catch { /* the profile is a nicety; the connection stands without it */ }

    const now = new Date().toISOString();
    const { error } = await ctx.service.from('whoop_connections').upsert({
      user_id: ctx.userId,
      whoop_user_id: whoopUserId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: expiresAt(t.expires_in),
      scopes: t.scope ?? null,
      connected_at: now,
      sync_started_at: null,
      last_error: null,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (error) return back(`whoop=error&reason=${encodeURIComponent(error.message)}`);

    // First pull: three months, so the tab has something to show straight away.
    try {
      await runSync(ctx.service, ctx.userId, 90);
    } catch (e) {
      // Connected, but the first sync failed — the tab will say so and offer a
      // retry. Not worth bouncing the user back to an error.
      if (!(e instanceof WhoopError && e.kind === 'busy')) {
        console.error('whoop first sync failed', e);
      }
    }

    const res = back('whoop=connected');
    res.cookies.set('whoop_state', '', { path: '/api/whoop', maxAge: 0 });
    return res;
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown';
    return back(`whoop=error&reason=${encodeURIComponent(reason)}`);
  }
}
