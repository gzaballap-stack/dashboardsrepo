// Client setup pack (NOTES.md 2026-11-23) — what a submitted survey prepares
// for the client's Facebook setup, so it only has to be copied and pasted:
//
//   • Zip codes: every zip within the client's radius of their company zip
//     (`client_surveys.audience`). Every client, whatever the service. A survey
//     that asks for specific zip codes instead of a radius gets an empty list
//     and a note to add them by hand.
//   • Copy pack: Facebook clients only — a copy of the active template on the
//     Copy page with the blanks filled in (lib/client-copy.ts), as the client's
//     own copy set (`creative_hub_copy_sets.client_id`).
//
// Made when the survey is submitted (client-survey-server.ts), shown on the
// client's Submitted Survey, and made again from there with one click. Never
// fails a submission: anything that goes wrong comes back as a warning.

import type { AuthContext } from './api-auth';
import { getZctasNearPoint, geocodeZip } from './census';
import { STARTER_TEMPLATE, blanksFor, fillBlanks } from './client-copy';
import { serviceOf, str, type Answers } from './client-survey';
import { tablesMissing } from './onboarding-server';

type Service = AuthContext['service'];
type Row = Record<string, unknown>;

export type Audience = { zip: string | null; radius: number | null; zips: string[]; note: string | null; made_at: string };
export type ClientPack = {
  id: string; name: string; bodies: string[]; headlines: string[]; descriptions: string[];
  cta: string | null; link: string | null; notes: string | null; updated_at: string;
};
type Template = ClientPack & { campaign_label: string | null };

const MAX_RADIUS = 200;
const NEEDS_UPDATE = 'The setup pack needs a one-off database update first (node scripts/migrate-client-setup-pack.mjs v1)';

/** The company zip and the radius from the survey's answers. */
export function areaOf(a: Answers): { zip: string | null; radius: number | null; note: string | null } {
  const zip = str(a, 'postal_code').replace(/\D/g, '').slice(0, 5);
  const miles = str(a, 'miles_out');
  if (/specific/i.test(miles)) return { zip: zip || null, radius: null, note: 'They work in specific zip codes, not a radius — add those by hand.' };
  const n = parseFloat(miles.match(/\d+(?:\.\d+)?/)?.[0] ?? '');
  if (!Number.isFinite(n) || n <= 0) return { zip: zip || null, radius: null, note: 'The survey has no radius — add the zip codes by hand.' };
  if (zip.length !== 5) return { zip: null, radius: Math.min(n, MAX_RADIUS), note: 'The survey has no company zip code — add the zip codes by hand.' };
  return { zip, radius: Math.min(n, MAX_RADIUS), note: n > MAX_RADIUS ? `Capped at ${MAX_RADIUS} miles.` : null };
}

/** Every zip in the radius. Throws if the Census cannot answer, so a half list is never saved. */
export async function makeAudience(a: Answers): Promise<Audience> {
  const { zip, radius, note } = areaOf(a);
  const made_at = new Date().toISOString();
  if (!zip || !radius) return { zip, radius, zips: [], note, made_at };
  const center = await geocodeZip(zip);
  if (!center) return { zip, radius, zips: [], note: `The Census has no zip code ${zip} — add the zip codes by hand.`, made_at };
  const zips = (await getZctasNearPoint(center.lat, center.lng, radius, true)).sort();
  return { zip, radius, zips, note, made_at };
}

const runsAds = (a: Answers, roster: string | null) =>
  [serviceOf(a), roster].some(s => s === 'facebook_ads' || s === 'both');

/** The active B2C template; the starter is put in the first time there is none at all. */
async function activeTemplate(service: Service): Promise<{ template: Template | null; error?: string }> {
  const cols = 'id, name, campaign_label, bodies, headlines, descriptions, cta, link, notes, updated_at';
  const { data, error } = await service.from('creative_hub_copy_sets').select(cols)
    .eq('scope', 'b2c').eq('is_template', true).eq('active', true).limit(1);
  if (error) return { template: null, error: tablesMissing(error) || /column/i.test(error.message ?? '') ? NEEDS_UPDATE : error.message };
  if (data?.length) return { template: data[0] as unknown as Template };
  const { count } = await service.from('creative_hub_copy_sets').select('id', { count: 'exact', head: true }).eq('scope', 'b2c').eq('is_template', true);
  if (count) return { template: null, error: 'No copy template is set as active on the Copy page' };
  const { data: made, error: e } = await service.from('creative_hub_copy_sets')
    .insert({ scope: 'b2c', is_template: true, active: true, ...STARTER_TEMPLATE }).select(cols).single();
  if (e) return { template: null, error: e.message };
  return { template: made as unknown as Template };
}
export { activeTemplate as ensureActiveTemplate };

async function packOf(service: Service, clientId: string): Promise<ClientPack | null> {
  const { data } = await service.from('creative_hub_copy_sets')
    .select('id, name, bodies, headlines, descriptions, cta, link, notes, updated_at')
    .eq('client_id', clientId).eq('scope', 'b2c').order('created_at').limit(1);
  return ((data ?? [])[0] as unknown as ClientPack | undefined) ?? null;
}

/**
 * Makes what is missing: the zip codes when there are none yet or the zip /
 * radius changed, and the copy pack when a Facebook client has none.
 * `again` remakes both — the pack's texts are refilled from the template.
 */
export async function makeSetup(service: Service, clientId: string, opts: { again?: boolean } = {}): Promise<{ done: string[]; warnings: string[] }> {
  const done: string[] = [], warnings: string[] = [];
  const [{ data: survey, error }, { data: client }] = await Promise.all([
    service.from('client_surveys').select('answers, audience').eq('client_id', clientId).maybeSingle(),
    service.from('clients').select('name, service').eq('id', clientId).maybeSingle(),
  ]);
  if (error) { warnings.push(/audience/.test(error.message ?? '') ? NEEDS_UPDATE : `Setup pack: ${error.message}`); return { done, warnings }; }
  if (!survey) { warnings.push('No survey for this client'); return { done, warnings }; }
  const a = (survey.answers ?? {}) as Answers;

  // 1. Zip codes
  const had = survey.audience as Audience | null;
  const want = areaOf(a);
  if (opts.again || !had || had.zip !== want.zip || had.radius !== want.radius) {
    try {
      const audience = await makeAudience(a);
      const { error: e } = await service.from('client_surveys').update({ audience }).eq('client_id', clientId);
      if (e) warnings.push(`Zip codes could not be saved: ${e.message}`);
      else if (audience.zips.length) done.push(`${audience.zips.length} zip codes within ${audience.radius} miles of ${audience.zip}`);
      else if (audience.note) warnings.push(`Zip codes: ${audience.note}`);
    } catch (e) {
      warnings.push(`Zip codes could not be worked out (${(e as Error).message}) — use Make Again on the survey`);
    }
  }

  // 2. Copy pack — Facebook clients only
  if (runsAds(a, (client?.service as string | null) ?? null)) {
    const existing = await packOf(service, clientId);
    if (!existing || opts.again) {
      const { template, error: te } = await activeTemplate(service);
      if (!template) warnings.push(`Copy pack: ${te ?? 'no active template'}`);
      else {
        const { values, missing } = blanksFor(a);
        const fill = (list: string[]) => (list ?? []).map(t => fillBlanks(t, values));
        const row: Row = {
          scope: 'b2c', client_id: clientId, is_template: false, active: false,
          name: String(client?.name ?? values.company ?? 'Client'), campaign_label: 'Client Pack',
          bodies: fill(template.bodies), headlines: fill(template.headlines), descriptions: fill(template.descriptions),
          cta: template.cta, link: existing?.link ?? null,
          notes: `Made from the template "${template.name}" on ${new Date().toISOString().slice(0, 10)}.${missing.length ? ` Not in the survey, left as blanks: ${missing.join(', ')}.` : ''}`,
          updated_at: new Date().toISOString(),
        };
        const q = existing
          ? service.from('creative_hub_copy_sets').update(row).eq('id', existing.id)
          : service.from('creative_hub_copy_sets').insert(row);
        const { error: pe } = await q;
        if (pe) warnings.push(`Copy pack could not be saved: ${pe.message}`);
        else {
          done.push(existing ? 'Copy pack remade from the template' : 'Copy pack made from the template');
          if (missing.length) warnings.push(`Copy pack: not in the survey, left as blanks — ${missing.join(', ')}`);
        }
      }
    }
  }
  return { done, warnings };
}

/** What the Submitted Survey shows. Null parts when not made (or the database has not had its update). */
export async function readSetup(service: Service, clientId: string): Promise<{ audience: Audience | null; pack: ClientPack | null; runs_ads: boolean }> {
  const [{ data: survey }, { data: client }, pack] = await Promise.all([
    service.from('client_surveys').select('answers, audience').eq('client_id', clientId).maybeSingle(),
    service.from('clients').select('service').eq('id', clientId).maybeSingle(),
    packOf(service, clientId).catch(() => null),
  ]);
  const a = ((survey as Row | null)?.answers ?? {}) as Answers;
  return {
    audience: ((survey as Row | null)?.audience as Audience | null) ?? null,
    pack,
    runs_ads: runsAds(a, (client?.service as string | null) ?? null),
  };
}
