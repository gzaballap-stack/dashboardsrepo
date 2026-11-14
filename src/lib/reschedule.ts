// A reschedule is not a new booking.
//
// GHL posts "appointment booked" again when a lead moves their appointment. Left
// alone that either moves the booking to the day it was moved (same GHL
// appointment id: the row is overwritten, booked date and all) or counts the
// lead as having booked twice (a new appointment id: a second row). Neither is
// a new booking, so on arrival:
//
//   same appointment id      → the same row, and it keeps the day it was first
//                              booked;
//   same lead, same client,  → stored as `rescheduled`, a type nothing counts:
//   booked in the last 60      not a booking on any dashboard, but still on
//   days, a different id       record (Raw Data lists it, Client Billing shows
//                              it on the appointment it belongs to).
//
// V1, last 90 days (2026-11-14): 238 bookings, 3 of them a lead booking again,
// all with a new appointment id; no show / no-show rows; no appointment time is
// sent, so "moved to when" is not known — only that it was moved.

import { phoneKey } from './attribution';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Service = any;

export const RESCHEDULED = 'rescheduled';
/** A lead booking again this long after their last booking is a new appointment. */
export const REBOOK_WINDOW_DAYS = 60;

const BOOKING_TYPES = ['appointment_booked', 'show', 'no_show', RESCHEDULED];

export type ArrivingBooking =
  | { kind: 'new' }
  /** Already stored under this appointment id: keep its first booked date and what it is. */
  | { kind: 'same'; first_booked_at: string; event_type: string; times: number }
  /** The lead already has a booking with this client: this one is it, moved. */
  | { kind: 'rescheduled'; original_id: string; original_booked_at: string };

export async function classifyBooking(service: Service, b: {
  client_id: string; external_id: string | null; ghl_contact_id: string | null; lead_phone: string | null; occurred_at: string;
}): Promise<ArrivingBooking> {
  if (b.external_id) {
    const { data } = await service.from('events')
      .select('id, client_id, event_type, occurred_at, raw')
      .eq('external_id', b.external_id).limit(1);
    const row = data?.[0];
    if (row && row.client_id === b.client_id && BOOKING_TYPES.includes(row.event_type)) {
      return { kind: 'same', first_booked_at: row.occurred_at, event_type: row.event_type, times: (Number(row.raw?._rebooked) || 0) + 1 };
    }
    if (row) return { kind: 'new' };      // that id belongs to something else: leave it to the write as before
  }

  const at = new Date(b.occurred_at).getTime();
  if (!Number.isFinite(at)) return { kind: 'new' };
  const since = new Date(at - REBOOK_WINDOW_DAYS * 86_400_000).toISOString();
  const earlier = () => service.from('events')
    .select('id, occurred_at')
    .eq('client_id', b.client_id).in('event_type', ['appointment_booked', 'show', 'no_show'])
    .gte('occurred_at', since).lt('occurred_at', b.occurred_at)
    .order('occurred_at', { ascending: true }).limit(1);

  // Their GHL contact, else their phone number.
  const phone = phoneKey(b.lead_phone);
  const reads = [];
  if (b.ghl_contact_id) reads.push(earlier().eq('ghl_contact_id', b.ghl_contact_id));
  if (phone) reads.push(earlier().like('lead_phone', `%${phone}`));
  const found = (await Promise.all(reads)).flatMap(r => (r.data ?? []) as { id: string; occurred_at: string }[])
    .sort((x, y) => new Date(x.occurred_at).getTime() - new Date(y.occurred_at).getTime());
  return found.length ? { kind: 'rescheduled', original_id: found[0].id, original_booked_at: found[0].occurred_at } : { kind: 'new' };
}

/** The database has not been told about the `rescheduled` type yet. */
export const refusesRescheduled = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === '23514' || /events_event_type_check|check constraint/i.test(error.message ?? ''));
