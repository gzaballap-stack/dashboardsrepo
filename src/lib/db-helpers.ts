import { createServiceClient } from './supabase';

// Sentinel used when filtering to live clients but none exist — guarantees empty results
// without crashing Supabase's IN() clause.
const NO_MATCH = '__no_match__';

export async function getLiveClientIds(
  service: ReturnType<typeof createServiceClient>
): Promise<string[]> {
  // Internal clients (Tomsi Media) never count as "live clients" in client-facing rollups.
  const { data } = await service.from('clients').select('id').eq('is_live', true).eq('is_internal', false);
  return (data ?? []).map(c => c.id);
}

// Returns the IDs to pass to `.in('client_id', ...)`, or the no-match sentinel if empty.
export function liveClientFilter(ids: string[]): string[] {
  return ids.length > 0 ? ids : [NO_MATCH];
}

/** Internal rows (e.g. Tomsi Media's own B2B funnel) are stored as clients so
 *  their dashboard can reuse the client views — they are never real clients.
 *  Every "all clients" aggregate must leave them out. */
export async function getInternalClientIds(service: ReturnType<typeof import('./supabase').createServiceClient>): Promise<string[]> {
  const { data } = await service.from('clients').select('id').eq('is_internal', true);
  return (data ?? []).map(c => c.id as string);
}
