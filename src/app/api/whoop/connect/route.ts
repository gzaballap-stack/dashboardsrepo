import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { authorizeUrl, whoopConfigured } from '@/lib/whoop';

// Step one of connecting: send the browser to Whoop to approve access. The
// `state` is checked on the way back so a stranger's redirect can't attach
// their Whoop to this account.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  if (!whoopConfigured()) {
    return NextResponse.redirect(new URL('/dashboard?whoop=error&reason=not-configured', req.url));
  }

  // Whoop asks for an eight-character state.
  const state = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

  const res = NextResponse.redirect(authorizeUrl(req, state));
  res.cookies.set('whoop_state', state, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/api/whoop', maxAge: 600,
  });
  return res;
}
