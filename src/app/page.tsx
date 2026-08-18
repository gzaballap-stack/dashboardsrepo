import { redirect } from 'next/navigation';
import { createAuthClient } from '@/lib/supabase';

export default async function RootPage() {
  try {
    const supabase = await createAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) redirect('/dashboard');
  } catch {
    // session unreadable — fall through to login
  }
  redirect('/login');
}
