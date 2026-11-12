// Onboarding board (Clients > Onboarding) — shared by the page, its API and the
// GHL onboarding-form webhook. See NOTES.md 2026-11-12.
//
// A card is one client being onboarded. It sits in one of three columns and,
// once Facebook or SMS is picked, carries its own copy of that checklist.

// Pure rules only — the board (a client component) imports this file. Anything
// that touches the database lives in onboarding-server.ts.

export type Track = 'facebook' | 'sms';
export type Stage = 'not_started' | 'in_progress' | 'done';
export const TRACKS: Track[] = ['facebook', 'sms'];
export const STAGES: Stage[] = ['not_started', 'in_progress', 'done'];
export const TRACK_LABEL: Record<Track, string> = { facebook: 'Facebook Ads', sms: 'SMS' };
export const STAGE_LABEL: Record<Stage, string> = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

// heading = a section title, check = tick it, text = type something in.
// `auto` steps do the work themselves:
//   roster      adds the client to the Client Roster (status Setup)
//   ad_account  saves the Meta ad account on the roster record, which is what
//               the scheduled spend sync reads — no other setup needed
export type ItemKind = 'heading' | 'check' | 'text';
export type AutoStep = 'roster' | 'ad_account';
export type TemplateItem = { id: string; kind: ItemKind; label: string; auto?: AutoStep };
export type CardItem = TemplateItem & { done?: boolean; value?: string; note?: string; by?: string; at?: string };

export type Card = {
  id: string; client_name: string; client_id: string | null; track: Track | null; stage: Stage;
  position: number; items: CardItem[]; notes: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  ghl_contact_id: string | null; source: string;
  created_at: string; updated_at: string; completed_at: string | null;
};

// The owner's process up to the point where Facebook and SMS part ways.
const BEFORE: TemplateItem[] = [
  { id: 'h_before',    kind: 'heading', label: 'Before onboarding' },
  { id: 'form',        kind: 'check',   label: 'Onboarding form submitted (GHL form, during the call)' },
  { id: 'call_booked', kind: 'check',   label: 'Onboarding call booked for the next day' },
  { id: 'call_done',   kind: 'check',   label: 'Onboarding call done' },
  { id: 'calendar',    kind: 'check',   label: 'Calendar connected' },
  { id: 'fb_access',   kind: 'check',   label: 'Facebook access received' },
];

// Starter lists. The owner edits them on the page (stored in
// onboarding_templates); these are what a fresh database shows.
export const DEFAULT_TEMPLATES: Record<Track, TemplateItem[]> = {
  facebook: [
    ...BEFORE,
    { id: 'h_setup',    kind: 'heading', label: 'Facebook Ads setup' },
    { id: 'roster',     kind: 'check',   label: 'Added to the Client Roster', auto: 'roster' },
    { id: 'ad_account', kind: 'text',    label: 'Ad account ID', auto: 'ad_account' },
  ],
  sms: [
    ...BEFORE,
    { id: 'h_setup', kind: 'heading', label: 'SMS setup' },
    { id: 'roster',  kind: 'check',   label: 'Added to the Client Roster', auto: 'roster' },
  ],
};

export const isTrack = (v: unknown): v is Track => v === 'facebook' || v === 'sms';
export const isStage = (v: unknown): v is Stage => STAGES.includes(v as Stage);

/** Steps that count towards progress (headings don't). */
export const steps = (items: CardItem[]) => items.filter(i => i.kind !== 'heading');
export function progress(items: CardItem[]) {
  const s = steps(items);
  return { done: s.filter(i => i.done).length, total: s.length };
}

/** Whatever the editor sends, as a clean template. Null = nothing usable. */
export function cleanTemplate(input: unknown): TemplateItem[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: TemplateItem[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const label = String(raw?.label ?? '').trim().slice(0, 300);
    if (!label) continue;
    const kind: ItemKind = raw.kind === 'heading' || raw.kind === 'text' ? raw.kind : 'check';
    const auto = raw.auto === 'roster' || raw.auto === 'ad_account' ? raw.auto : undefined;
    let id = String(raw?.id ?? '').trim().slice(0, 60) || `s_${Math.random().toString(36).slice(2, 10)}`;
    while (seen.has(id)) id = `${id}_${Math.random().toString(36).slice(2, 6)}`;
    seen.add(id);
    // An automatic step keeps the shape its automation expects.
    out.push(auto ? { id, kind: auto === 'ad_account' ? 'text' : 'check', label, auto } : { id, kind, label });
  }
  return out.length ? out : null;
}

/** A card's checklist from a template, keeping what was already ticked or typed. */
export function snapshot(template: TemplateItem[], prev: CardItem[] = []): CardItem[] {
  const old = new Map(prev.map(i => [i.id, i]));
  return template.map(t => {
    const p = old.get(t.id);
    return p && t.kind !== 'heading' ? { ...t, done: p.done, value: p.value, note: p.note, by: p.by, at: p.at } : { ...t };
  });
}

/**
 * The ad account from whatever was pasted: `act_123`, `act=123`, bare digits,
 * or a whole Ads Manager link. Stored the way Meta's API wants it (`act_123`).
 */
export function parseAdAccount(raw: string): string | null {
  const s = (raw ?? '').trim();
  const m = s.match(/act[_=](\d{6,})/i) ?? s.match(/^(\d{6,})$/);
  return m ? `act_${m[1]}` : null;
}
