import { redirect } from 'next/navigation';
import { createAuthClient } from '@/lib/supabase';

export default async function RootPage() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');
  redirect('/login');
}
