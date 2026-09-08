import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createAuthClient } from '@/lib/supabase';
import DashboardView from '@/components/DashboardView';
import { routeForSlug, titleForSlug } from '@/lib/dashboard-routes';

// Optional catch-all: `/dashboard` still works, and every menu item now also has
// its own `/dashboard/<section>/<view>` URL.
type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${titleForSlug(slug)} — Tomsi Media` };
}

export default async function DashboardPage({ params }: Props) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { slug } = await params;
  return <DashboardView initialRoute={routeForSlug(slug)} />;
}
