import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase';
import { sanitizeViews, DEFAULT_NEW_USER_VIEWS } from '@/lib/feature-access';
import type { AuthContext } from '@/lib/api-auth';

// Managing accounts is admin-only. Accounts created before profiles carried an
// admin flag are treated as non-admin, which is the safe direction.
async function requireAdmin(): Promise<AuthContext | NextResponse> {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data } = await ctx.service
    .from('profiles')
    .select('is_admin')
    .eq('id', ctx.userId)
    .maybeSingle();

  if (data?.is_admin !== true) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  return ctx;
}

// The middleware gates requests off the auth user's app_metadata so it never has
// to hit the database. `profiles` stays the source of truth; this keeps the copy
// the middleware reads in step with it.
async function mirrorToAuth(
  service: ReturnType<typeof createServiceClient>,
  id: string,
  patch: { is_admin?: boolean; allowed_views?: string[] | null },
) {
  const { data } = await service.auth.admin.getUserById(id);
  const current = (data?.user?.app_metadata ?? {}) as Record<string, unknown>;
  await service.auth.admin.updateUserById(id, {
    app_metadata: { ...current, ...patch },
  });
}

export async function GET() {
  const ctx = await requireAdmin();
  if (isAuthError(ctx)) return ctx;

  const service = ctx.service;
  const { data, error } = await service.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await service.from('profiles').select('id, is_admin, allowed_views');
  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

  const users = data.users.map(u => ({
    id: u.id,
    email: u.email,
    is_admin: profileMap[u.id]?.is_admin ?? false,
    // null means "not restricted yet" — the UI shows that as full access.
    allowed_views: sanitizeViews(profileMap[u.id]?.allowed_views),
    created_at: u.created_at,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const ctx = await requireAdmin();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { email, password, is_admin } = body;
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const service = ctx.service;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const admin = is_admin === true;
  // Admins are never restricted. A new non-admin starts with whatever was ticked
  // at creation, defaulting to their own personal tools only; the admin widens it
  // from the user list afterwards. Existing accounts are left alone.
  const allowed = admin ? null : (sanitizeViews(body.allowed_views) ?? DEFAULT_NEW_USER_VIEWS);

  await service.from('profiles').update({ is_admin: admin, allowed_views: allowed }).eq('id', data.user.id);
  await mirrorToAuth(service, data.user.id, { is_admin: admin, allowed_views: allowed });

  return NextResponse.json({ success: true, user: { id: data.user.id, email: data.user.email } });
}

export async function DELETE(req: Request) {
  const ctx = await requireAdmin();
  if (isAuthError(ctx)) return ctx;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await ctx.service.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  const ctx = await requireAdmin();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { id, password, is_admin } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const service = ctx.service;

  if (password) {
    const { error } = await service.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const mirror: { is_admin?: boolean; allowed_views?: string[] | null } = {};

  if (is_admin !== undefined) {
    await service.from('profiles').update({ is_admin }).eq('id', id);
    mirror.is_admin = is_admin === true;
  }

  // `allowed_views: null` clears the restriction — that account sees everything.
  if ('allowed_views' in body) {
    const allowed = body.allowed_views === null ? null : sanitizeViews(body.allowed_views) ?? [];
    await service.from('profiles').update({ allowed_views: allowed }).eq('id', id);
    mirror.allowed_views = allowed;
  }

  if (Object.keys(mirror).length) await mirrorToAuth(service, id, mirror);

  return NextResponse.json({ success: true });
}
