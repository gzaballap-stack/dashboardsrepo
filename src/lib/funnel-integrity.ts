import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

const FUNNEL_DOWNSTREAM = new Set(['appointment_booked', 'show', 'no_show', 'closed']);

// A booked demo, show, no-show or close implies the contact was a lead first.
// If that lead event was never captured (a missed webhook), synthesise one so the
// funnel isn't broken — e.g. a no-show that arrived without its lead still counts
// a lead. Idempotent and duplicate-safe: skipped when any lead already exists for
// the contact, and the deterministic external_id means races/replays can't create
// a second one.
export async function ensureLeadForContact(
  service: Service,
  opts: {
    client_id: string;
    ghl_contact_id: string | null | undefined;
    event_type: string;
    occurred_at: string;
    lead_name?: string | null;
    lead_phone?: string | null;
    lead_email?: string | null;
    attribution?: Record<string, unknown>;
  },
): Promise<void> {
  const { client_id, ghl_contact_id, event_type } = opts;
  if (!client_id || !ghl_contact_id) return;
  if (!FUNNEL_DOWNSTREAM.has(event_type)) return;

  const { data: existing } = await service
    .from('events')
    .select('id')
    .eq('client_id', client_id)
    .eq('ghl_contact_id', ghl_contact_id)
    .eq('event_type', 'lead')
    .limit(1);
  if (existing && existing.length) return;

  await service.from('events').upsert(
    {
      client_id,
      event_type: 'lead',
      occurred_at: opts.occurred_at,
      ghl_contact_id,
      external_id: `auto-lead:${ghl_contact_id}`,
      lead_name: opts.lead_name ?? null,
      lead_phone: opts.lead_phone ?? null,
      lead_email: opts.lead_email ?? null,
      ...(opts.attribution ?? {}),
      raw: { synthesized: 'lead', reason: `downstream ${event_type} without a lead` },
    },
    { onConflict: 'external_id' },
  );
}

// When a real lead finally arrives for a contact, drop any lead we synthesised
// earlier so the contact isn't counted twice.
export async function removeSyntheticLead(
  service: Service,
  client_id: string,
  ghl_contact_id: string | null | undefined,
): Promise<void> {
  if (!client_id || !ghl_contact_id) return;
  await service
    .from('events')
    .delete()
    .eq('client_id', client_id)
    .eq('event_type', 'lead')
    .eq('external_id', `auto-lead:${ghl_contact_id}`);
}
