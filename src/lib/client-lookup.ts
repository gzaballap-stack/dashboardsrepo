import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

// GHL sends the client name as free text on every workflow, so spelling drifts:
// "D&B Construction" for "D and B Construction", a stray "LLC", odd casing. The
// webhooks used to match on `name` alone, and a mismatch silently dropped the
// event (Make treats the 400 as a successful run).
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(and|llc|inc|incorporated|ltd|limited|co|corp|corporation)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Exact match first — that's the normal path and stays byte-for-byte as it was.
// The normalised pass only sees names the exact match rejected, and refuses to
// guess when it fits more than one client: crediting events to the wrong client
// is worse than dropping them.
export async function resolveClientId(service: Service, rawName: string): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;

  const { data: exact } = await service.from('clients').select('id').eq('name', name).maybeSingle();
  if (exact?.id) return exact.id;

  const target = normalizeName(name);
  if (!target) return null;

  const { data: clients } = await service.from('clients').select('id, name');
  const named = (clients ?? []).map(c => ({ id: c.id as string, norm: normalizeName(c.name as string) }));

  // Word-for-word first, then ignoring word breaks ("DB Construction").
  for (const key of [(n: string) => n, (n: string) => n.replace(/ /g, '')]) {
    const matches = named.filter(c => key(c.norm) === key(target));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) return null;
  }
  return null;
}
