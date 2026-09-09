/**
 * Minimal iCalendar reader for Google Calendar's private .ics feeds.
 *
 * Covers what a real calendar actually contains: timed and all-day events,
 * named-timezone start/end times, repeating events (daily/weekly/monthly/
 * yearly with INTERVAL, COUNT, UNTIL and BYDAY), deleted occurrences (EXDATE)
 * and edited single occurrences (RECURRENCE-ID). Anything more exotic is
 * returned as its first occurrence rather than dropped.
 */

export type CalEvent = {
  uid: string;
  title: string;
  start: string;        // ISO instant
  end: string;          // ISO instant
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  attendees: string[];
  meetUrl: string | null;
  status: string | null;
  feed?: string | null;
};

type RawProp = { value: string; params: Record<string, string> };
type RawEvent = Record<string, RawProp[]>;

/** RFC 5545 folds long lines with a leading space or tab. */
const pad2 = (n: number) => String(n).padStart(2, "0");

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): { name: string; prop: RawProp } | null {
  const colon = findUnquoted(line, ":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitUnquoted(left, ";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, prop: { value, params } };
}

function findUnquoted(s: string, ch: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    else if (s[i] === ch && !quoted) return i;
  }
  return -1;
}

function splitUnquoted(s: string, ch: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (const c of s) {
    if (c === '"') { quoted = !quoted; cur += c; }
    else if (c === ch && !quoted) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/**
 * Wall-clock time in a named zone → the actual instant.
 * Probes the zone's offset with Intl rather than shipping a tz database.
 */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUtc - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);   // second pass settles DST boundaries
  return new Date(ms);
}

function parseDate(prop: RawProp): { date: Date; allDay: boolean } {
  const v = prop.value.trim();
  const tz = prop.params["TZID"];
  const dateOnly = /^\d{8}$/.test(v) || prop.params["VALUE"] === "DATE";

  if (dateOnly) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    return { date: new Date(Date.UTC(y, mo - 1, d)), allDay: true };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { date: new Date(v), allDay: false };
  const [, ys, mos, ds, hs, mis, ss, z] = m;
  const y = +ys, mo = +mos, d = +ds, h = +hs, mi = +mis, s = +ss;

  if (z) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  if (tz) { try { return { date: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false }; } catch { /* fall through */ } }
  return { date: new Date(y, mo - 1, d, h, mi, s), allDay: false };  // floating: local
}

function splitEvents(lines: string[]): RawEvent[] {
  const events: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0;   // ignore nested components such as VALARM

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) { cur = {}; depth = 0; continue; }
    if (upper.startsWith("END:VEVENT")) { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (upper.startsWith("BEGIN:")) { depth++; continue; }
    if (upper.startsWith("END:")) { depth--; continue; }
    if (depth > 0) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;
    (cur[parsed.name] ||= []).push(parsed.prop);
  }
  return events;
}

const first = (e: RawEvent, name: string) => e[name]?.[0];
const text = (e: RawEvent, name: string) => {
  const p = first(e, name);
  return p ? unescape(p.value).trim() || null : null;
};

const MEET = /(https:\/\/[^\s<>"]*(?:meet\.google\.com|zoom\.us\/j\/|teams\.microsoft\.com|whereby\.com)[^\s<>"]*)/i;

function findMeetUrl(e: RawEvent): string | null {
  for (const key of ["X-GOOGLE-CONFERENCE", "LOCATION", "DESCRIPTION"]) {
    const v = text(e, key);
    const hit = v && MEET.exec(v);
    if (hit) return hit[1];
  }
  return null;
}

const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(v: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of v.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/** Occurrence start times for one event that fall inside [from, to]. */
function expand(e: RawEvent, startDate: Date, from: Date, to: Date): Date[] {
  // Widened: an event can start before the window and still run inside it, and an
  // all-day event sits at UTC midnight while the window is local.
  const lo = new Date(from.getTime() - 2 * 86400000);
  const hi = new Date(to.getTime() + 2 * 86400000);

  const rule = first(e, "RRULE");
  if (!rule) return startDate >= lo && startDate <= hi ? [startDate] : [];

  const r = parseRRule(rule.value);
  const freq = (r["FREQ"] || "").toUpperCase();
  const interval = Math.max(1, Number(r["INTERVAL"] || 1));
  const count = r["COUNT"] ? Number(r["COUNT"]) : null;
  const until = r["UNTIL"] ? parseDate({ value: r["UNTIL"], params: {} }).date : null;
  const byDay = (r["BYDAY"] || "").split(",").map(d => d.trim().slice(-2).toUpperCase()).filter(d => d in DAY_INDEX);

  const skip = new Set<number>();
  for (const ex of e["EXDATE"] ?? []) {
    for (const one of ex.value.split(",")) {
      skip.add(parseDate({ value: one, params: ex.params }).date.getTime());
    }
  }

  const hits: Date[] = [];
  const hardStop = new Date(Math.min(hi.getTime(), Date.now() + 400 * 86400000));
  let cursor = new Date(startDate);
  let made = 0;

  // Cap the walk so a malformed or endless rule can never spin.
  for (let guard = 0; guard < 5000; guard++) {
    if (cursor > hardStop) break;
    if (until && cursor > until) break;
    if (count != null && made >= count) break;

    let emit = true;
    if (freq === "WEEKLY" && byDay.length) emit = byDay.some(d => DAY_INDEX[d] === cursor.getDay());
    if (emit) {
      made++;
      if (cursor >= lo && cursor <= hi && !skip.has(cursor.getTime())) hits.push(new Date(cursor));
    }

    if (freq === "DAILY") cursor = new Date(cursor.getTime() + interval * 86400000);
    else if (freq === "WEEKLY") {
      cursor = byDay.length
        ? new Date(cursor.getTime() + 86400000)   // step a day; BYDAY filters above
        : new Date(cursor.getTime() + interval * 7 * 86400000);
    } else if (freq === "MONTHLY") { const d = new Date(cursor); d.setMonth(d.getMonth() + interval); cursor = d; }
    else if (freq === "YEARLY") { const d = new Date(cursor); d.setFullYear(d.getFullYear() + interval); cursor = d; }
    else break;
  }
  return hits;
}

/** Every occurrence between `from` and `to`, sorted by start time. */
export function parseIcs(ics: string, from: Date, to: Date, feed?: string | null): CalEvent[] {
  const raws = splitEvents(unfold(ics));

  // An edited single occurrence replaces the generated one.
  const overrides = new Map<string, RawEvent>();
  for (const e of raws) {
    const rid = first(e, "RECURRENCE-ID");
    const uid = text(e, "UID");
    if (rid && uid) overrides.set(`${uid}@${parseDate(rid).date.getTime()}`, e);
  }

  const utcDay = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const localDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fromDay = localDay(from);
  const toDay = localDay(to);

  /** All-day events are compared by calendar date; everything else by overlap. */
  const inWindow = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) {
      const lastDay = utcDay(new Date(Math.max(start.getTime(), end.getTime() - 1)));
      return utcDay(start) <= toDay && lastDay >= fromDay;
    }
    return start.getTime() < to.getTime() && end.getTime() > from.getTime();
  };

  const out: CalEvent[] = [];

  const build = (e: RawEvent, start: Date, durationMs: number, allDay: boolean): CalEvent => {
    const attendees = (e["ATTENDEE"] ?? [])
      .map(a => a.params["CN"] || a.value.replace(/^mailto:/i, ""))
      .filter(Boolean);
    const org = first(e, "ORGANIZER");
    return {
      uid: text(e, "UID") ?? `${start.getTime()}`,
      title: text(e, "SUMMARY") ?? "(no title)",
      start: start.toISOString(),
      end: new Date(start.getTime() + durationMs).toISOString(),
      allDay,
      location: text(e, "LOCATION"),
      description: text(e, "DESCRIPTION"),
      organizer: org ? (org.params["CN"] || org.value.replace(/^mailto:/i, "")) : null,
      attendees,
      meetUrl: findMeetUrl(e),
      status: text(e, "STATUS"),
      feed: feed ?? null,
    };
  };

  for (const e of raws) {
    if (first(e, "RECURRENCE-ID")) continue;            // handled as an override
    if ((text(e, "STATUS") ?? "").toUpperCase() === "CANCELLED") continue;

    const dtstart = first(e, "DTSTART");
    if (!dtstart) continue;
    const { date: start, allDay } = parseDate(dtstart);
    if (Number.isNaN(start.getTime())) continue;

    const dtend = first(e, "DTEND");
    let durationMs = allDay ? 86400000 : 3600000;
    if (dtend) {
      const end = parseDate(dtend).date;
      if (!Number.isNaN(end.getTime())) durationMs = Math.max(0, end.getTime() - start.getTime());
    }

    const uid = text(e, "UID") ?? "";
    for (const occurrence of expand(e, start, from, to)) {
      const override = overrides.get(`${uid}@${occurrence.getTime()}`);
      if (override) {
        if ((text(override, "STATUS") ?? "").toUpperCase() === "CANCELLED") continue;
        const od = first(override, "DTSTART");
        if (!od) continue;
        const { date: os, allDay: oAll } = parseDate(od);
        const oe = first(override, "DTEND");
        const oDur = oe ? Math.max(0, parseDate(oe).date.getTime() - os.getTime()) : durationMs;
        if (inWindow(os, new Date(os.getTime() + oDur), oAll)) out.push(build(override, os, oDur, oAll));
      } else if (inWindow(occurrence, new Date(occurrence.getTime() + durationMs), allDay)) {
        out.push(build(e, occurrence, durationMs, allDay));
      }
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}
