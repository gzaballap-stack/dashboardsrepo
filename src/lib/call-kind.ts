/**
 * The three kinds of call on the Task Board.
 *
 *  - sales call — the first appointment, booked through the booking tool
 *  - follow-up  — booked from the Calls panel *with* the person's email, so
 *                 they are invited: "<Name> | Follow-up call"
 *  - dial       — booked *without* an email, a reminder to ring them at that
 *                 time: "<Name> | Dial"
 *
 * Read from the event title everywhere. On the task rows that put calls on the
 * non-negotiables strip (origin = 'calendar') the kind is kept in `priority` —
 * those rows never sit in the ABCDE columns, so their level is otherwise unused.
 */
export type CallKind = "sales" | "followup" | "dial";

export const FOLLOW_UP_RE = /\|\s*follow-up call\s*$/i;
export const DIAL_RE = /\|\s*dial\s*$/i;

export function callKindOf(title: string): CallKind {
  if (FOLLOW_UP_RE.test(title)) return "followup";
  if (DIAL_RE.test(title)) return "dial";
  return "sales";
}

export const CALL_KIND_PRIORITY: Record<CallKind, number> = { sales: 1, followup: 2, dial: 3 };
export const PRIORITY_CALL_KIND: Record<number, CallKind> = { 1: "sales", 2: "followup", 3: "dial" };

export const CALL_KIND_LABEL: Record<CallKind, string> = {
  sales: "sales call",
  followup: "follow-up",
  dial: "dial",
};

/** Booked from the Calls panel — counts as a call even with no guest or meeting link. */
export const isBookedHere = (title: string) => FOLLOW_UP_RE.test(title) || DIAL_RE.test(title);
