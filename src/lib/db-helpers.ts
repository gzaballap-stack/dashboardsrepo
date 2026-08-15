import { createServiceClient } from './supabase';

// Sentinel used when filtering to live clients but none exist — guarantees empty results
// without crashing Supabase's IN() clause.
const NO_MATCH = '__no_match__';

export async function getLiveClientIds(
  service: ReturnType<typeof createServiceClient>
): Promise<string[]> {
  const { data } = await service.from('clients').select('id').eq('is_live', true);
  return (data ?? []).map(c => c.id);
}

// Returns the IDs to pass to `.in('client_id', ...)`, or the no-match sentinel if empty.
export function liveClientFilter(ids: string[]): string[] {
  return ids.length > 0 ? ids : [NO_MATCH];
}
