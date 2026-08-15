import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  const service = createServiceClient();
  const { count } = await service.from('profiles').select('*', { count: 'exact', head: true });
  return NextResponse.json({ needsSetup: (count ?? 0) === 0 });
}

export async function POST(req: Request) {
  const service = createServiceClient();

  // Block if any users already exist
  const { count } = await service.from('profiles').select('*', { count: 'exact', head: true });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'Setup already complete' }, { status: 403 });
  }

  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await service.from('profiles').update({ is_admin: true }).eq('id', data.user.id);

  return NextResponse.json({ success: true });
}
