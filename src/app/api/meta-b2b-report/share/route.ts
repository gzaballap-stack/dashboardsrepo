import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// The read-only share link for the Meta media-buying reports. One link for the
// whole account (it is Tomsi Media's own data, not a client's), turned on and
// off here; the report route accepts the token in place of a session.
//   GET            → { token: string | null }
//   PATCH {share}  → create (true) or delete (false) the link

export const SHARE_KEY = 'b2b_report';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const { data, error } = await ctx.service.from('share_links').select('token').eq('key', SHARE_KEY).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data?.token ?? null });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (body.share === false) {
    const { error } = await ctx.service.from('share_links').delete().eq('key', SHARE_KEY);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ token: null });
  }
  if (body.share === true) {
    // Turning it on again rotates the token, so a leaked link can be killed.
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const { error } = await ctx.service.from('share_links')
      .upsert({ key: SHARE_KEY, token, created_by: ctx.userId, created_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ token });
  }
  return NextResponse.json({ error: 'share must be true or false' }, { status: 400 });
}
