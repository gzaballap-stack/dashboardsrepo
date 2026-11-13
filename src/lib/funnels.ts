// Funnels: the website funnel's versions and what each one produced.
// Tables: funnels, funnel_versions, funnel_events (supabase/migrations/add_funnels.sql).
import type { createServiceClient } from '@/lib/supabase';
import { DEFAULT_CONTENT } from '@/lib/funnel-content';

type Service = ReturnType<typeof createServiceClient>;

export const DEFAULT_FUNNEL = {
  slug: 'check-your-market',
  name: 'Check Your Market',
  site_url: 'https://tomsimedia.com/check-your-market',
};

export type FunnelRow = { id: string; slug: string; name: string; client_id: string | null; site_url: string | null };
export type VersionRow = {
  id: string; funnel_id: string; number: number; name: string; notes: string; content: unknown;
  status: 'draft' | 'live' | 'paused' | 'archived'; weight: number; published_at: string | null;
  created_at: string; updated_at: string;
};

export const VERSION_COLS = 'id, funnel_id, number, name, notes, content, status, weight, published_at, created_at, updated_at';

/** True when the error means the funnel tables have not been created in this database yet. */
export const tablesMissing = (message: string | undefined | null) =>
  /funnels|funnel_versions|funnel_events|schema cache|does not exist/i.test(message ?? '');

/**
 * The website's funnel, created on first use with version 1 (the funnel as it
 * was built) live. Safe to call on every request: it only writes once.
 */
export async function ensureDefaultFunnel(service: Service): Promise<FunnelRow | null> {
  const cols = 'id, slug, name, client_id, site_url';
  const found = await service.from('funnels').select(cols).eq('slug', DEFAULT_FUNNEL.slug).maybeSingle();
  if (found.error) return null;
  let funnel = found.data as FunnelRow | null;
  if (!funnel) {
    await service.from('funnels').upsert(DEFAULT_FUNNEL, { onConflict: 'slug', ignoreDuplicates: true });
    const again = await service.from('funnels').select(cols).eq('slug', DEFAULT_FUNNEL.slug).maybeSingle();
    funnel = again.data as FunnelRow | null;
    if (!funnel) return null;
  }
  const { count } = await service.from('funnel_versions').select('id', { count: 'exact', head: true }).eq('funnel_id', funnel.id);
  if (!count) {
    await service.from('funnel_versions').upsert({
      funnel_id: funnel.id, number: 1, name: 'Original', content: DEFAULT_CONTENT,
      status: 'live', weight: 100, published_at: new Date().toISOString(),
    }, { onConflict: 'funnel_id,number', ignoreDuplicates: true });
  }
  return funnel;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export type VersionStats = {
  visitors: number;          // people who opened the page
  started: number;           // answered the first question
  q2: number;                // answered the revenue question
  q3: number;                // gave their company
  disqualified: number;      // ended by an answer
  leads: number;             // sent their contact details
  calendar: number;          // saw the calendar
  booked: number;            // booked a call
  shown: number;
  closed: number;
  revenue: number;
  spend: number;             // that version's share of ad spend
  first_seen: string | null;
  last_seen: string | null;
};

const empty = (): VersionStats => ({
  visitors: 0, started: 0, q2: 0, q3: 0, disqualified: 0, leads: 0, calendar: 0, booked: 0, shown: 0, closed: 0, revenue: 0,
  spend: 0, first_seen: null, last_seen: null,
});

const PAGE = 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

type Ev = { version_id: string; visitor_id: string; event_type: string; step: number; ghl_contact_id: string | null; occurred_at: string };

/**
 * What each version produced between two dates (both optional, YYYY-MM-DD).
 *
 * People are counted once per version. A booked call, show or close belongs to
 * the version the lead came in on, whenever it happens (they are read from the
 * B2B funnel by contact). Ad spend is shared out day by day: a version gets the
 * part of that day's spend that matches its part of that day's landing-page
 * visitors, the old funnel's visitors included.
 */
export async function funnelStats(service: Service, funnel: FunnelRow, start?: string | null, end?: string | null): Promise<{ versions: Record<string, VersionStats>; legacy: VersionStats | null }> {
  const events = await all<Ev>(() => {
    let q = service.from('funnel_events')
      .select('version_id, visitor_id, event_type, step, ghl_contact_id, occurred_at')
      .eq('funnel_id', funnel.id).order('occurred_at', { ascending: true });
    if (start) q = q.gte('occurred_at', `${start}T00:00:00.000Z`);
    if (end)   q = q.lte('occurred_at', `${end}T23:59:59.999Z`);
    return q;
  });

  const stats: Record<string, VersionStats> = {};
  const of = (id: string) => (stats[id] ??= empty());
  const contactVersion = new Map<string, string>();          // contact → the version they came in on
  const bookedPage = new Map<string, Set<string>>();         // version → visitors who reached the booked page
  const leadVisitors = new Map<string, Set<string>>();       // version → visitors who became leads
  const visitsByDay = new Map<string, Map<string, number>>(); // day → version → visitors

  for (const e of events) {
    const s = of(e.version_id);
    if (!s.first_seen) s.first_seen = e.occurred_at;
    s.last_seen = e.occurred_at;
    if (e.event_type === 'visit') {
      s.visitors++;
      const day = e.occurred_at.slice(0, 10);
      const m = visitsByDay.get(day) ?? new Map<string, number>();
      m.set(e.version_id, (m.get(e.version_id) ?? 0) + 1);
      visitsByDay.set(day, m);
    } else if (e.event_type === 'step') {
      if (e.step === 1) s.started++;
      else if (e.step === 2) s.q2++;
      else if (e.step === 3) s.q3++;
    } else if (e.event_type === 'disqualified') s.disqualified++;
    else if (e.event_type === 'lead') {
      s.leads++;
      if (e.ghl_contact_id && !contactVersion.has(e.ghl_contact_id)) contactVersion.set(e.ghl_contact_id, e.version_id);
      (leadVisitors.get(e.version_id) ?? leadVisitors.set(e.version_id, new Set()).get(e.version_id)!).add(e.visitor_id);
    } else if (e.event_type === 'calendar') s.calendar++;
    else if (e.event_type === 'booked') {
      (bookedPage.get(e.version_id) ?? bookedPage.set(e.version_id, new Set()).get(e.version_id)!).add(e.visitor_id);
    }
  }

  // Booked calls, shows and closes: the B2B funnel's own records, by contact.
  // Only Tomsi Media's funnel has them; the demo database has no such table.
  let fromGhl = false;
  if (!funnel.client_id && contactVersion.size) {
    try {
      const ids = [...contactVersion.keys()];
      const seen = new Set<string>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await service.from('b2b_events')
          .select('event_type, ghl_contact_id, revenue')
          .in('ghl_contact_id', ids.slice(i, i + 150))
          .in('event_type', ['sales_call_booked', 'sales_call_shown', 'close']);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) {
          const v = contactVersion.get(r.ghl_contact_id as string);
          if (!v) continue;
          const s = of(v);
          if (r.event_type === 'close') { s.closed++; s.revenue += Number(r.revenue) || 0; continue; }
          const key = `${r.event_type}:${r.ghl_contact_id}`;          // a contact books / shows once here
          if (seen.has(key)) continue;
          seen.add(key);
          if (r.event_type === 'sales_call_booked') s.booked++;
          else s.shown++;
        }
      }
      fromGhl = true;
    } catch { /* fall back to the booked page below */ }
  }
  if (!fromGhl) for (const [v, set] of bookedPage) of(v).booked = set.size;
  // A booking the page saw but GoHighLevel has not reported yet still counts.
  else for (const [v, set] of bookedPage) {
    const leads = leadVisitors.get(v);
    const pageBooked = [...set].filter(x => !leads || leads.has(x)).length;
    if (pageBooked > of(v).booked) of(v).booked = pageBooked;
  }

  // Ad spend, shared out by where each day's landing-page visitors went.
  let allocated = 0;
  if (!funnel.client_id && visitsByDay.size) {
    try {
      const days = [...visitsByDay.keys()].sort();
      const [spendRows, landingRows] = await Promise.all([
        all<{ amount: number | null; spend_date: string }>(() => service.from('b2b_ad_spend').select('amount, spend_date')
          .gte('spend_date', days[0]).lte('spend_date', days[days.length - 1])),
        all<{ external_id: string | null; occurred_at: string }>(() => service.from('b2b_events').select('external_id, occurred_at')
          .eq('event_type', 'visit_landing')
          .gte('occurred_at', `${days[0]}T00:00:00.000Z`).lte('occurred_at', `${days[days.length - 1]}T23:59:59.999Z`)),
      ]);
      const spendByDay = new Map<string, number>();
      for (const r of spendRows) spendByDay.set(r.spend_date, (spendByDay.get(r.spend_date) ?? 0) + (Number(r.amount) || 0));
      const landingByDay = new Map<string, number>();
      const seen = new Set<string>();
      for (const r of landingRows) {
        const day = r.occurred_at.slice(0, 10);
        if (r.external_id) { const k = `${day}:${r.external_id}`; if (seen.has(k)) continue; seen.add(k); }
        landingByDay.set(day, (landingByDay.get(day) ?? 0) + 1);
      }
      for (const [day, byVersion] of visitsByDay) {
        const spend = spendByDay.get(day) ?? 0;
        if (!spend) continue;
        const ours = [...byVersion.values()].reduce((a, b) => a + b, 0);
        const total = Math.max(landingByDay.get(day) ?? 0, ours);
        for (const [v, n] of byVersion) { of(v).spend += spend * (n / total); allocated += spend * (n / total); }
      }
    } catch { /* no spend table: spend stays 0 */ }
  }

  for (const s of Object.values(stats)) { s.spend = Math.round(s.spend * 100) / 100; s.revenue = Math.round(s.revenue * 100) / 100; }

  let legacy: VersionStats | null = null;
  if (!funnel.client_id) {
    try { legacy = await legacyStats(service, funnel, start ?? null, end ?? null, allocated); } catch { /* no B2B tables here */ }
  }
  return { versions: stats, legacy };
}

/**
 * The funnel that ran before this one: the GoHighLevel pages. Its numbers are
 * the B2B funnel's own records (ads only, SMS left out) with everything that
 * belongs to a version of the new funnel taken out: its visitors, its leads'
 * contacts, and its share of ad spend. Counted by the date each thing happened,
 * and only from the day page visits started being recorded, so the rates compare
 * like with like.
 */
async function legacyStats(service: Service, funnel: FunnelRow, start: string | null, end: string | null, allocated: number): Promise<VersionStats | null> {
  const first = await service.from('b2b_events').select('occurred_at').eq('event_type', 'visit_landing').order('occurred_at', { ascending: true }).limit(1);
  if (first.error) throw new Error(first.error.message);
  const firstDay = first.data?.[0]?.occurred_at?.slice(0, 10) ?? null;
  if (!firstDay) return null;
  const from = start && start > firstDay ? start : firstDay;

  const mine = await all<{ visitor_id: string; ghl_contact_id: string | null; event_type: string }>(() =>
    service.from('funnel_events').select('visitor_id, ghl_contact_id, event_type').eq('funnel_id', funnel.id).in('event_type', ['visit', 'lead']));
  const newVisitors = new Set(mine.filter(e => e.event_type === 'visit').map(e => e.visitor_id));
  const newContacts = new Set(mine.map(e => e.ghl_contact_id).filter((c): c is string => !!c));

  const rows = await all<{ event_type: string; ghl_contact_id: string | null; external_id: string | null; revenue: number | null; occurred_at: string }>(() => {
    let q = service.from('b2b_events').select('event_type, ghl_contact_id, external_id, revenue, occurred_at')
      .in('event_type', ['visit_landing', 'lead', 'sales_call_booked', 'sales_call_shown', 'close'])
      .or('ad_platform.is.null,ad_platform.neq.sms')
      .gte('occurred_at', `${from}T00:00:00.000Z`).order('occurred_at', { ascending: true });
    if (end) q = q.lte('occurred_at', `${end}T23:59:59.999Z`);
    return q;
  });

  const s = empty();
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.ghl_contact_id && newContacts.has(r.ghl_contact_id)) continue;
    if (r.event_type === 'visit_landing') {
      const key = r.external_id;
      if (key) {
        if (newVisitors.has(key.split(':')[1] ?? '') || seen.has(key)) continue;
        seen.add(key);
      }
      s.visitors++;
    } else if (r.event_type === 'lead') s.leads++;
    else if (r.event_type === 'sales_call_booked') s.booked++;
    else if (r.event_type === 'sales_call_shown') s.shown++;
    else { s.closed++; s.revenue += Number(r.revenue) || 0; }
    if (!s.first_seen) s.first_seen = r.occurred_at;
    s.last_seen = r.occurred_at;
  }

  const spend = await all<{ amount: number | null }>(() => {
    let q = service.from('b2b_ad_spend').select('amount').gte('spend_date', from);
    if (end) q = q.lte('spend_date', end);
    return q;
  });
  s.spend = Math.max(0, Math.round((spend.reduce((a, r) => a + (Number(r.amount) || 0), 0) - allocated) * 100) / 100);
  s.revenue = Math.round(s.revenue * 100) / 100;
  return s;
}
