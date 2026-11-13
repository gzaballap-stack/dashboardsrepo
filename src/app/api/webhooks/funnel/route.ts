import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { POST as b2bWebhook } from '@/app/api/webhooks/b2b/route';
import { DEFAULT_FUNNEL, ensureDefaultFunnel, tablesMissing, type FunnelRow } from '@/lib/funnels';
import { normalizeContent } from '@/lib/funnel-content';

// The website's side of Funnels (Tomsi Media > Funnels).
//
//   GET  ?slug=<funnel>[&version=<id>]   which versions are live and what they say
//                                        (version=<id> also returns that one, live or not, for previews)
//   POST { slug, version_id, visitor_id, event, step?, contact_id?, utm? }
//                                        one visitor step, counted once per person per version
//
// Public by necessity: the page and its visitors' browsers call it. It can only
// read published wording and add funnel steps, nothing else. Visits, calendar
// views and bookings of Tomsi Media's own funnel are also passed to the B2B
// funnel (as the old funnel page's snippet did), so the Ads Dashboard's page
// numbers keep counting.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISITOR = /^[A-Za-z0-9_-]{8,48}$/;
const SLUG = /^[a-z0-9-]{1,80}$/;
const EVENTS = ['visit', 'step', 'disqualified', 'lead', 'calendar', 'booked'];
const TO_B2B: Record<string, string> = { visit: 'visit_landing', calendar: 'visit_calendar', booked: 'visit_thankyou' };
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function funnelBySlug(service: ReturnType<typeof createServiceClient>, slug: string): Promise<FunnelRow | null | 'missing'> {
  if (slug === DEFAULT_FUNNEL.slug) {
    const probe = await service.from('funnels').select('id').limit(1);
    if (probe.error) return tablesMissing(probe.error.message) ? 'missing' : null;
    return ensureDefaultFunnel(service);
  }
  const { data, error } = await service.from('funnels').select('id, slug, name, client_id, site_url').eq('slug', slug).maybeSingle();
  if (error) return tablesMissing(error.message) ? 'missing' : null;
  return (data as FunnelRow | null) ?? null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug') ?? '';
  const wanted = searchParams.get('version') ?? '';
  if (!SLUG.test(slug)) return json({ ready: false, error: 'Unknown funnel' }, 400);

  const service = createServiceClient();
  const funnel = await funnelBySlug(service, slug);
  if (funnel === 'missing' || !funnel) return json({ ready: false });

  const { data: live, error } = await service.from('funnel_versions')
    .select('id, number, weight, content').eq('funnel_id', funnel.id).eq('status', 'live').order('number');
  if (error) return json({ ready: false });
  const shape = (v: { id: string; number: number; weight: number; content: unknown }) =>
    ({ id: v.id, number: v.number, weight: v.weight, content: normalizeContent(v.content) });

  let preview = null;
  if (UUID.test(wanted)) {
    const { data } = await service.from('funnel_versions')
      .select('id, number, weight, content').eq('funnel_id', funnel.id).eq('id', wanted).maybeSingle();
    if (data) preview = shape(data);
  }
  return json({ ready: true, funnel: { id: funnel.id, slug: funnel.slug }, versions: (live ?? []).map(shape), preview });
}

// version id → its funnel, remembered for a few minutes so a visitor's steps do
// not each cost a lookup.
const known = new Map<string, { at: number; funnel_id: string; internal: boolean }>();
const KNOWN_MS = 5 * 60_000;

export async function POST(req: Request) {
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(await req.text()); } catch { return json({ error: 'Bad request' }, 400); }

  const version_id = String(p.version_id ?? '');
  const visitor_id = String(p.visitor_id ?? '');
  const event = String(p.event ?? '');
  const step = Number.isInteger(p.step) ? Math.max(0, Math.min(9, p.step as number)) : 0;
  const contact = typeof p.contact_id === 'string' && /^[A-Za-z0-9]{10,40}$/.test(p.contact_id) ? p.contact_id : null;
  if (!UUID.test(version_id) || !VISITOR.test(visitor_id) || !EVENTS.includes(event)) return json({ error: 'Bad request' }, 400);

  const service = createServiceClient();
  let v = known.get(version_id);
  if (!v || Date.now() - v.at > KNOWN_MS) {
    const { data, error } = await service.from('funnel_versions').select('funnel_id, funnels(client_id)').eq('id', version_id).maybeSingle();
    if (error || !data) return json({ success: false }, error && !tablesMissing(error.message) ? 500 : 200);
    const f = data.funnels as unknown as { client_id: string | null } | { client_id: string | null }[] | null;
    const clientId = Array.isArray(f) ? f[0]?.client_id : f?.client_id;
    v = { at: Date.now(), funnel_id: data.funnel_id as string, internal: !clientId };
    known.set(version_id, v);
  }

  const utm = (p.utm && typeof p.utm === 'object' ? p.utm : {}) as Record<string, unknown>;
  const utmCols = Object.fromEntries(UTM_KEYS.map(k => [k, typeof utm[k] === 'string' && utm[k] ? (utm[k] as string).slice(0, 200) : null]));

  const { data: added, error } = await service.from('funnel_events')
    .upsert({
      funnel_id: v.funnel_id, version_id, visitor_id, event_type: event,
      step: event === 'step' || event === 'disqualified' ? step : 0,
      ghl_contact_id: event === 'lead' ? contact : null, ...utmCols,
    }, { onConflict: 'version_id,visitor_id,event_type,step', ignoreDuplicates: true })
    .select('id');
  if (error) return json({ success: false }, 500);
  const isNew = (added?.length ?? 0) > 0;

  // The same person sending their details again: keep the contact if it was missing.
  if (!isNew && event === 'lead' && contact) {
    await service.from('funnel_events').update({ ghl_contact_id: contact })
      .eq('version_id', version_id).eq('visitor_id', visitor_id).eq('event_type', 'lead').is('ghl_contact_id', null);
  }

  if (isNew && v.internal && TO_B2B[event]) {
    try {
      await b2bWebhook(new Request(new URL('/api/webhooks/b2b', req.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_WEBHOOK_SECRET ?? ''}` },
        body: JSON.stringify({
          event_type: TO_B2B[event], external_id: `${TO_B2B[event]}:${visitor_id}`, occurred_at: new Date().toISOString(),
          ...Object.fromEntries(Object.entries(utmCols).filter(([, val]) => val)),
        }),
      }));
    } catch { /* the page numbers are secondary; the funnel step is already stored */ }
  }
  return json({ success: true });
}
