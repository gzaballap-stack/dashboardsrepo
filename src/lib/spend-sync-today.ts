// Spend syncs are scheduled from Make, which asks for *yesterday* (a finished
// day). To keep the dashboard current during the day, each scheduled sync also
// refreshes the following day — i.e. today, so far. Syncs are upserts, so today
// is simply overwritten by every later run and finalised by tomorrow's run.
//
// Only applies to a "recent" request (the scheduled run), never to a backfill
// of old dates, and never to a date that hasn't started anywhere yet.

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The day after `date` if it should be synced as well, else null. */
export function followUpDate(date: unknown): string | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (now - d.getTime() > 3 * DAY) return null;            // a backfill, not the scheduled run
  const next = new Date(d.getTime() + DAY);
  if (next.getTime() > now + 14 * 3_600_000) return null;  // not started in any timezone yet
  return iso(next);
}
