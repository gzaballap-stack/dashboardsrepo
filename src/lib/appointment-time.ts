// When an appointment is for — as opposed to when it was booked.
//
// GHL's workflow webhook carries the appointment under `calendar`: `startTime`
// as a wall-clock time in the calendar's timezone, with no offset
// ("2026-11-20T14:00:00"), and that timezone in `selectedTimezone`. A workflow
// can also send it as Custom Data (`appointment_time`, optionally
// `appointment_timezone`), which wins.
//
// Two things are kept, because they answer different questions:
//   at     the instant, UTC — for ordering and for "has it happened yet";
//   local  the wall-clock date and time where the appointment is
//          ("2026-11-20T14:00") — for "which day / which week is it on". A
//          Saturday 6pm appointment in Chicago is on Saturday, whatever the
//          clock says where the dashboard is being read.

export type AppointmentTime = { at: string; local: string; tz: string | null };

const pad = (n: number) => String(n).padStart(2, '0');

/** Minutes `tz` is ahead of UTC at instant `t`. Throws on an unknown zone. */
function offsetMinutes(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find(p => p.type === k)?.value);
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - t) / 60_000;
}

/** A wall-clock time in `tz` → the instant. null when the zone isn't one. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date | null {
  try {
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    let t = wall - offsetMinutes(wall, tz) * 60_000;
    t = wall - offsetMinutes(t, tz) * 60_000;         // again, for the hours around a clock change
    return new Date(t);
  } catch { return null; }
}

/** The wall-clock date and time of an instant in `tz`. null when the zone isn't one. */
export function localIn(at: Date, tz: string): string | null {
  try {
    const shifted = new Date(at.getTime() + offsetMinutes(at.getTime(), tz) * 60_000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  } catch { return null; }
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const ISO_WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** Reads an appointment time as GHL sends it. null = nothing usable was sent. */
export function parseAppointmentTime(value: unknown, timezone: unknown): AppointmentTime | null {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!text) return null;
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : null;

  // A number: seconds or milliseconds since 1970.
  if (/^\d{10,13}$/.test(text)) {
    const at = new Date(Number(text) * (text.length <= 10 ? 1000 : 1));
    if (Number.isNaN(at.getTime())) return null;
    return { at: at.toISOString(), local: (tz ? localIn(at, tz) : null) ?? at.toISOString().slice(0, 16), tz };
  }

  // Carries its own offset: the instant is exact.
  if (HAS_OFFSET.test(text) && !Number.isNaN(new Date(text).getTime())) {
    const at = new Date(text);
    return { at: at.toISOString(), local: (tz ? localIn(at, tz) : null) ?? text.replace(' ', 'T').slice(0, 16), tz };
  }

  // A wall-clock time — ISO-like, or written out ("Friday, November 20, 2026 2:00 PM").
  let y: number, mo: number, d: number, h: number, mi: number;
  const iso = text.match(ISO_WALL);
  if (iso) {
    [y, mo, d, h, mi] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5])];
  } else {
    // Read as if it were UTC, only to pull the written date and time apart.
    const loose = new Date(`${text.replace(/^[A-Za-z]+,\s*/, '')} UTC`);
    if (Number.isNaN(loose.getTime())) return null;
    [y, mo, d, h, mi] = [loose.getUTCFullYear(), loose.getUTCMonth() + 1, loose.getUTCDate(), loose.getUTCHours(), loose.getUTCMinutes()];
  }
  if (!(y > 2000 && y < 2100) || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const local = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
  // No timezone to go by: the day is still right, the instant is taken as UTC.
  const at = (tz ? zonedToUtc(y, mo, d, h, mi, tz) : null) ?? new Date(Date.UTC(y, mo - 1, d, h, mi));
  return { at: at.toISOString(), local, tz };
}

/** "2026-11-20T14:00" → "2026-11-20". Anything else → null. */
export const dayOfLocal = (local: unknown): string | null =>
  typeof local === 'string' && /^\d{4}-\d{2}-\d{2}/.test(local) ? local.slice(0, 10) : null;
