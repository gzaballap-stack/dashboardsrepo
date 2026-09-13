import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

// Tomsi Media's own B2B funnel is mirrored into the client-side tables under
// this internal client, so the entire client dashboard works for B2B unchanged.
export const TOMSI_CLIENT_NAME = 'Tomsi Media';

let cached: { id: string; at: number } | null = null;

export async function getTomsiClientId(service: Service): Promise<string | null> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.id;
  const { data } = await service
    .from('clients').select('id').eq('is_internal', true).eq('name', TOMSI_CLIENT_NAME).maybeSingle();
  if (!data?.id) return null;
  cached = { id: data.id as string, at: Date.now() };
  return cached.id;
}
