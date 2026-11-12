// Onboarding board — the database side (cards, templates, roster, Meta check).
// The rules it applies are in onboarding.ts. See NOTES.md 2026-11-12.

import { resolveClientId } from './client-lookup';
import type { createServiceClient } from './supabase';
import {
  DEFAULT_TEMPLATES, cleanTemplate, isTrack, snapshot,
  type Card, type CardItem, type Stage, type TemplateItem, type Track,
} from './onboarding';

type Service = ReturnType<typeof createServiceClient>;

const missing = (e: { message?: string } | null | undefined) =>
  !!e && /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
export const tablesMissing = missing;

export async function readTemplates(service: Service): Promise<Record<Track, TemplateItem[]>> {
  const out = { facebook: DEFAULT_TEMPLATES.facebook, sms: DEFAULT_TEMPLATES.sms };
  const { data } = await service.from('onboarding_templates').select('track, items');
  for (const row of (data ?? []) as { track: string; items: unknown }[]) {
    const items = cleanTemplate(row.items);
    if (isTrack(row.track) && items) out[row.track] = items;
  }
  return out;
}

/** Where a new card goes: the bottom of Not started. */
async function nextPosition(service: Service, stage: Stage): Promise<number> {
  const { data } = await service.from('onboarding_cards').select('position').eq('stage', stage)
    .order('position', { ascending: false }).limit(1);
  return Number((data?.[0] as { position?: number } | undefined)?.position ?? 0) + 1;
}

export type NewCard = {
  client_name: string; contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null;
  ghl_contact_id?: string | null; source?: 'manual' | 'ghl_form' | 'survey'; created_by?: string | null; track?: Track | null;
  /** The roster record, when it is already known (the survey makes it first). */
  client_id?: string | null;
  /** Who gets the credit for the steps the source already covers. */
  by?: string;
};

/**
 * Create a card. A GHL form that fires twice for the same contact (or a name
 * that already has a card under way) gets the card it already has, not a twin.
 * A client on both services has one card per checklist, so two cards with the
 * same name are twins only if they are not on different checklists.
 */
export async function createCard(service: Service, input: NewCard): Promise<{ card?: Card; existing?: boolean; error?: string }> {
  const client_name = input.client_name.trim().slice(0, 200);
  if (!client_name) return { error: 'A client name is needed' };

  const { data: open, error: openErr } = await service.from('onboarding_cards')
    .select('*').neq('stage', 'done');
  if (openErr) return { error: openErr.message };
  const sameList = (c: Card) => !c.track || !input.track || c.track === input.track;
  const twin = ((open ?? []) as Card[]).find(c => sameList(c) && (
    (!!input.ghl_contact_id && c.ghl_contact_id === input.ghl_contact_id) ||
    c.client_name.trim().toLowerCase() === client_name.toLowerCase()));
  if (twin) return { card: twin, existing: true };

  let items: CardItem[] = [];
  if (input.track) items = snapshot((await readTemplates(service))[input.track]);
  items = await coveredSteps(service, items, input.source ?? 'manual', input.client_id, input.by);

  const { data, error } = await service.from('onboarding_cards').insert({
    client_name, track: input.track ?? null, items, client_id: input.client_id ?? null,
    contact_name: input.contact_name || null, contact_email: input.contact_email || null,
    contact_phone: input.contact_phone || null, ghl_contact_id: input.ghl_contact_id || null,
    source: input.source ?? 'manual', created_by: input.created_by ?? null,
    position: await nextPosition(service, 'not_started'),
  }).select('*').single();
  if (error) return { error: error.message };
  return { card: data as Card };
}

/** The card came from a form or the survey, so "survey submitted" is already true. */
export function markFormDone(items: CardItem[], by = 'GHL form'): CardItem[] {
  return items.map(i => i.id === 'form' && !i.done ? { ...i, done: true, by, at: new Date().toISOString() } : i);
}

/**
 * Tick what is already true when a checklist lands on a card: the survey step
 * (the card came from a form), the roster step (the client is on the roster)
 * and the ad account (already saved on the roster record).
 */
export async function coveredSteps(
  service: Service, items: CardItem[], source: string, clientId: string | null | undefined, by?: string,
): Promise<CardItem[]> {
  let out = items;
  if (source === 'ghl_form') out = markFormDone(out, 'GHL form');
  if (source === 'survey') out = markFormDone(out, by ?? 'survey');
  if (clientId) {
    const at = new Date().toISOString();
    out = out.map(i => i.auto === 'roster' && !i.done ? { ...i, done: true, note: 'On the roster', by: by ?? 'roster', at } : i);
    out = await fillFromRoster(service, clientId, out);
  }
  return out;
}

type RosterService = 'facebook_ads' | 'sms' | 'both';

/**
 * Put a client on the Client Roster. An existing record (matched the same
 * forgiving way the webhooks match names) is linked, never duplicated; a new
 * one starts in Setup, which keeps it out of the live numbers until its first
 * lead or booking flips it to Live. A client already on the other service
 * becomes Both.
 */
export async function ensureRosterFor(
  service: Service, input: { name: string; clientId?: string | null; wanted: RosterService | null },
): Promise<{ client_id?: string; created?: boolean; error?: string }> {
  const { wanted } = input;
  let id = input.clientId ?? await resolveClientId(service, input.name);
  let created = false;
  if (id) {
    const { data } = await service.from('clients').select('id, service').eq('id', id).maybeSingle();
    if (!data) id = null;
    else if (wanted && data.service !== wanted && data.service !== 'both') {
      await service.from('clients').update({ service: data.service ? 'both' : wanted }).eq('id', id);
    }
  }
  if (!id) {
    const { data, error } = await service.from('clients')
      .insert({ name: input.name.trim(), status: 'setup', is_live: false, service: wanted })
      .select('id').single();
    if (error) return { error: error.message };
    id = data.id as string; created = true;
  }
  return { client_id: id as string, created };
}

export function ensureRoster(service: Service, card: Card) {
  return ensureRosterFor(service, {
    name: card.client_name, clientId: card.client_id,
    wanted: card.track === 'sms' ? 'sms' : card.track === 'facebook' ? 'facebook_ads' : null,
  });
}

/** Ask Meta whether our token can see the account. Null = could not check. */
export async function lookupAdAccount(account: string): Promise<{ ok: boolean; name?: string; error?: string } | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${account}?fields=name&access_token=${encodeURIComponent(token)}`);
    const json = await res.json() as { name?: string; error?: { message?: string } };
    if (json.error) return { ok: false, error: json.error.message };
    return { ok: true, name: json.name };
  } catch {
    return null;
  }
}

/**
 * A client already on the roster may already have its ad account saved (an
 * existing client adding a service, or a card switched between lists). Show it
 * as done rather than asking for it again.
 */
export async function fillFromRoster(service: Service, clientId: string | null | undefined, items: CardItem[]): Promise<CardItem[]> {
  if (!clientId || !items.some(i => i.auto === 'ad_account' && !i.done)) return items;
  const { data } = await service.from('clients').select('meta_account_id').eq('id', clientId).maybeSingle();
  const account = (data as { meta_account_id?: string | null } | null)?.meta_account_id;
  if (!account) return items;
  return items.map(i => i.auto === 'ad_account' && !i.done
    ? { ...i, done: true, value: account, note: 'Already saved on the roster — ad spend syncs on its own', by: 'roster', at: new Date().toISOString() }
    : i);
}
