// Finds a new client's Meta ad account by itself and saves it on the roster
// record, so nobody has to remember to paste it (SAS Home Solutions ran for two
// weeks with $0 tracked because that step was missed — NOTES.md 2026-11-14).
//
// The spend sync only reads clients with `clients.meta_account_id`. Once a
// client grants Facebook access, their account shows up in the list our token
// can see; this matches that list against the roster by name and links the
// ones it is sure about. It runs on every scheduled spend sync, when the new
// client survey is submitted, and when "Facebook access received" is ticked.
//
// It only ever fills an EMPTY ad account, and only on a one-to-one name match:
// two accounts that could be the client, or one account that could be two
// clients, is left for a person to paste on the Onboarding card.

import type { createServiceClient } from './supabase';
import type { CardItem } from './onboarding';

type Service = ReturnType<typeof createServiceClient>;
export type MetaAccount = { id: string; name: string; business: string };
type ClientRow = { id: string; name: string; meta_account_id: string | null; service: string | null; status: string | null };
export type Linked = { client_id: string; client_name: string; account: string; account_name: string };

const GRAPH = 'https://graph.facebook.com/v19.0';
// Tomsi Media's own account — never a client's.
const OWN_ACCOUNTS = new Set(['act_1080664784142903']);

// "Mr. Handy Plus Services, Inc. Ad Account" and "Mr Handy Plus Services INC"
// are the same business; so are "Tubcutters USA" and "Tub Cutters USA".
const NOISE = new Set(['ad', 'ads', 'account', 'accounts', 'llc', 'inc', 'co', 'corp', 'ltd', 'the', 'and']);
export function nameKey(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/[&+]/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(w => w && !NOISE.has(w)).join('');
}

/** 2 = the same name, 1 = one is the start of the other (and long enough to mean it), 0 = no. */
function closeness(a: string, b: string): 0 | 1 | 2 {
  if (!a || !b) return 0;
  if (a === b) return 2;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.startsWith(short) ? 1 : 0;
}
const score = (acct: MetaAccount, client: string): 0 | 1 | 2 =>
  Math.max(closeness(nameKey(acct.name), client), closeness(nameKey(acct.business), client)) as 0 | 1 | 2;

/**
 * The one account that is this client's, or null when it is not certain: no
 * match, more than one possible account, or an account that also reads as
 * another client's.
 */
export function pickAccount(
  client: { id: string; name: string }, free: MetaAccount[], everyClient: { id: string; key: string }[],
): MetaAccount | null {
  const key = nameKey(client.name);
  const scored = free.map(a => ({ a, s: score(a, key) })).filter(x => x.s > 0);
  const exact = scored.filter(x => x.s === 2);
  const pick = exact.length === 1 ? exact[0].a : scored.length === 1 ? scored[0].a : null;
  if (!pick) return null;
  return everyClient.some(k => k.id !== client.id && score(pick, k.key) > 0) ? null : pick;
}

/** Every ad account our token can see. Null = Meta could not be asked. */
async function visibleAccounts(): Promise<MetaAccount[] | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return null;
  const out: MetaAccount[] = [];
  let url: string | undefined = `${GRAPH}/me/adaccounts?fields=name,account_id,business_name&limit=200&access_token=${encodeURIComponent(token)}`;
  try {
    for (let page = 0; url && page < 10; page++) {
      const json = await (await fetch(url)).json() as {
        data?: { account_id?: string; name?: string; business_name?: string }[];
        error?: { message?: string }; paging?: { next?: string };
      };
      if (json.error) return null;
      for (const a of json.data ?? []) {
        if (a.account_id) out.push({ id: `act_${a.account_id}`, name: a.name ?? '', business: a.business_name ?? '' });
      }
      url = json.paging?.next;
    }
  } catch {
    return null;
  }
  return out;
}

/** Tick the "Ad account ID" step on the client's Onboarding card(s). Best-effort. */
async function tickCards(service: Service, l: Linked) {
  try {
    const { data } = await service.from('onboarding_cards').select('id, items').eq('client_id', l.client_id);
    for (const card of (data ?? []) as { id: string; items: CardItem[] }[]) {
      if (!Array.isArray(card.items) || !card.items.some(i => i.auto === 'ad_account' && !i.done)) continue;
      const at = new Date().toISOString();
      const items = card.items.map(i => i.auto === 'ad_account' && !i.done
        ? { ...i, done: true, value: l.account, note: `${l.account_name ? `${l.account_name} — ` : ''}found on Facebook and linked; ad spend syncs on its own`, by: 'automatic', at }
        : i);
      await service.from('onboarding_cards').update({ items, updated_at: at }).eq('id', card.id);
    }
  } catch { /* the board is a convenience; the link itself is what matters */ }
}

/**
 * Link every Facebook Ads client that has no ad account yet to the account
 * Meta shows under its name. `clientId` narrows it to one client (the survey,
 * a card). `cards: false` leaves the Onboarding cards to the caller.
 */
export async function linkAdAccounts(
  service: Service, opts: { clientId?: string; cards?: boolean } = {},
): Promise<{ linked: Linked[]; waiting: string[] }> {
  const none = { linked: [], waiting: [] };
  const { data, error } = await service.from('clients')
    .select('id, name, meta_account_id, service, status').eq('is_internal', false);
  if (error) return none;
  const clients = (data ?? []) as ClientRow[];

  const wanting = clients.filter(c => !c.meta_account_id && c.service !== 'sms' && c.status !== 'offline'
    && (!opts.clientId || c.id === opts.clientId));
  if (!wanting.length) return none;

  const accounts = await visibleAccounts();
  if (!accounts) return { linked: [], waiting: wanting.map(c => c.name) };

  const taken = new Set(clients.map(c => c.meta_account_id).filter(Boolean) as string[]);
  const free = accounts.filter(a => !taken.has(a.id) && !OWN_ACCOUNTS.has(a.id));
  const keys = clients.map(c => ({ id: c.id, key: nameKey(c.name) }));

  const linked: Linked[] = [];
  const waiting: string[] = [];
  for (const client of wanting) {
    const pick = pickAccount(client, free, keys);
    if (!pick || taken.has(pick.id)) { waiting.push(client.name); continue; }

    const { data: saved, error: saveErr } = await service.from('clients')
      .update({ meta_account_id: pick.id }).eq('id', client.id).is('meta_account_id', null).select('id');
    if (saveErr || !saved?.length) { waiting.push(client.name); continue; }
    taken.add(pick.id);
    const l: Linked = { client_id: client.id, client_name: client.name, account: pick.id, account_name: pick.name };
    linked.push(l);
    if (opts.cards !== false) await tickCards(service, l);
  }
  if (linked.length) console.log('[ad-account-link] linked', JSON.stringify(linked));
  return { linked, waiting };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A client whose account is linked but whose spend has never been stored: the
 * days it spent on before `before`, so linking late loses nothing. Counted from
 * the client's first lead or booking (else the day it joined the roster), at
 * most 30 days back. One Meta call; days with no spend are not returned.
 */
export async function missedSpendDays(
  service: Service, client: { id: string; meta_account_id: string }, before: string,
): Promise<string[]> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return [];
  const { data: stored } = await service.from('ad_spend').select('id').eq('client_id', client.id).limit(1);
  if (stored?.length) return [];

  const [{ data: first }, { data: row }] = await Promise.all([
    service.from('events').select('occurred_at').eq('client_id', client.id).order('occurred_at', { ascending: true }).limit(1),
    service.from('clients').select('created_at').eq('id', client.id).maybeSingle(),
  ]);
  const starts = [first?.[0]?.occurred_at, (row as { created_at?: string } | null)?.created_at]
    .filter(Boolean).map(v => new Date(String(v)).getTime()).filter(Number.isFinite);
  if (!starts.length) return [];
  const until = new Date(new Date(`${before}T00:00:00Z`).getTime() - DAY);
  const since = new Date(Math.max(Math.min(...starts), until.getTime() - 29 * DAY));
  if (since.getTime() > until.getTime()) return [];

  try {
    const params = new URLSearchParams({
      fields: 'spend', time_increment: '1', limit: '100',
      time_range: JSON.stringify({ since: iso(since), until: iso(until) }),
      access_token: token,
    });
    const json = await (await fetch(`${GRAPH}/${client.meta_account_id}/insights?${params}`)).json() as {
      data?: { date_start?: string; spend?: string }[]; error?: unknown;
    };
    if (json.error) return [];
    return (json.data ?? []).filter(d => d.date_start && Number(d.spend) > 0).map(d => d.date_start as string).sort();
  } catch {
    return [];
  }
}
