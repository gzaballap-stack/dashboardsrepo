import type { AuthContext } from '@/lib/api-auth';

type Service = AuthContext['service'];

// Calls moved or deleted from the Task Board's Calls panel. Google's private
// feed (what the dashboard reads) can take hours to show the change, so until it
// does the old copy would come back. Each change leaves its old non-negotiable
// row behind as a hidden marker (scope 'skipped', origin 'calendar') whose notes
// say what happened: "moved:<new start ISO>" or "deleted". Every read of the
// feed applies them; once the feed catches up there is nothing left to apply.

export type CallChange = { deleted: true } | { deleted: false; to: string };

export const callKey = (userId: string, uid: string, startISO: string) =>
  `cal:${userId}:${uid}:${new Date(startISO).toISOString()}`;

export async function loadCallChanges(service: Service, userId: string): Promise<Map<string, CallChange>> {
  const { data } = await service.from('tasks').select('external_key, notes')
    .eq('user_id', userId).eq('origin', 'calendar').eq('scope', 'skipped');
  const map = new Map<string, CallChange>();
  for (const r of data ?? []) {
    if (!r.external_key || !r.notes) continue;
    if (r.notes === 'deleted') map.set(r.external_key, { deleted: true });
    else if (r.notes.startsWith('moved:')) {
      const to = new Date(r.notes.slice(6));
      if (!Number.isNaN(to.getTime())) map.set(r.external_key, { deleted: false, to: to.toISOString() });
    }
  }
  return map;
}

/** The feed's events as they really are now: moved ones at their new time, deleted ones gone. */
export function applyCallChanges<E extends { uid: string; start: string; end: string }>(
  events: E[], userId: string, changes: Map<string, CallChange>,
): E[] {
  if (!changes.size) return events;
  const out: E[] = [];
  for (const e of events) {
    let cur = e;
    let gone = false;
    for (let hop = 0; hop < 10; hop++) {        // moved more than once: follow the chain
      const c = changes.get(callKey(userId, cur.uid, cur.start));
      if (!c) break;
      if (c.deleted) { gone = true; break; }
      if (c.to === cur.start) break;
      const len = new Date(cur.end).getTime() - new Date(cur.start).getTime();
      cur = { ...cur, start: c.to, end: new Date(new Date(c.to).getTime() + len).toISOString() };
    }
    if (!gone) out.push(cur);
  }
  // A move can land two copies on one slot (the feed caught up on one hop only).
  const seen = new Set<string>();
  return out.filter(e => { const k = e.uid + e.start; if (seen.has(k)) return false; seen.add(k); return true; });
}
