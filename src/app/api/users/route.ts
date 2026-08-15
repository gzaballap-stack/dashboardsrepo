import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await service.from('profiles').select('id, is_admin');
  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

  const users = data.users.map(u => ({
    id: u.id,
    email: u.email,
    is_admin: profileMap[u.id]?.is_admin ?? false,
    created_at: u.created_at,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { email, password, is_admin } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (is_admin) {
    await service.from('profiles').update({ is_admin: true }).eq('id', data.user.id);
  }

  return NextResponse.json({ success: true, user: { id: data.user.id, email: data.user.email } });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id, password, is_admin } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const service = createServiceClient();

  if (password) {
    const { error } = await service.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (is_admin !== undefined) {
    await service.from('profiles').update({ is_admin }).eq('id', id);
  }

  return NextResponse.json({ success: true });
}
