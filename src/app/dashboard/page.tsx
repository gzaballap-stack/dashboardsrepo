import { redirect } from 'next/navigation';
import { createAuthClient } from '@/lib/supabase';
import DashboardView from '@/components/DashboardView';

export default async function DashboardPage() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <DashboardView />;
}
