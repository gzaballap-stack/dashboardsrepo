// New client survey (Clients > New Client Survey) — the questions, and what counts as
// a usable answer. Pure: the form (browser) and the API both read this file.
//
// The questions mirror the GHL onboarding form the owner used before, plus the
// service we are setting up (the roster, the checklist and billing need it).
// Card details are NOT part of these answers: the survey screen takes them in
// its own section and sends them to the card vault (lib/card-vault.ts), which
// encrypts them. Never add a card field here — answers are stored readable.

import type { Track } from './onboarding';

export type Answers = Record<string, string | string[]>;
export type FieldType = 'text' | 'tel' | 'email' | 'textarea' | 'money' | 'choice' | 'multi';
export type SurveyField = {
  key: string; label: string; type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean; placeholder?: string; hint?: string;
  /** Takes the whole row instead of half of it. */
  wide?: boolean;
  /** Only asked when this is true of the answers so far. */
  when?: (a: Answers) => boolean;
};

const opts = (...labels: string[]) => labels.map(l => ({ value: l, label: l }));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const has = (a: Answers, key: string, value: string) => Array.isArray(a[key]) ? (a[key] as string[]).includes(value) : a[key] === value;

export type SurveySection = { title: string; fields: SurveyField[]; /** Filled in by us before the client sees the survey. */ setup?: boolean };

const runsAds = (a: Answers) => has(a, 'service', 'facebook_ads') || has(a, 'service', 'both');

export const SURVEY_SECTIONS: SurveySection[] = [
  {
    // Page one, filled in by us. The client's link carries these; the client never sees or changes them.
    title: 'What We Are Setting Up', setup: true,
    fields: [
      { key: 'service', label: 'Service', type: 'choice', required: true, wide: true,
        options: [{ value: 'facebook_ads', label: 'Facebook Ads' }, { value: 'sms', label: 'SMS' }, { value: 'both', label: 'Both' }] },
      { key: 'price_per_appointment', label: 'Price per appointment', type: 'money', placeholder: '0' },
      // What they paid on signing. Submitting turns these into Client Billing
      // records (credits, and a payment) — once: see applyPrepaid on the server.
      { key: 'prepaid_appointments', label: 'Prepaid appointments', type: 'text', placeholder: '0' },
      { key: 'cash_collected', label: 'Cash collected', type: 'money', placeholder: '0' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text' },
      { key: 'last_name', label: 'Last name', type: 'text' },
      { key: 'personal_phone', label: 'Personal phone', type: 'tel' },
      { key: 'personal_email', label: 'Personal email', type: 'email' },
    ],
  },
  {
    title: 'Business',
    fields: [
      { key: 'business_name', label: 'Business name', type: 'text', required: true, wide: true },
      { key: 'business_email', label: 'Business email', type: 'email' },
      { key: 'business_phone', label: 'Business main number', type: 'tel' },
      { key: 'website', label: 'Website link', type: 'text', wide: true, placeholder: 'https://' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { key: 'street_address', label: 'Street address', type: 'text', wide: true },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'postal_code', label: 'Postal code', type: 'text' },
      { key: 'country', label: 'Country', type: 'text', placeholder: 'United States' },
    ],
  },
  {
    title: 'Appointments',
    fields: [
      { key: 'appointment_phones', label: 'Phone number or numbers to send appointments to', type: 'text', wide: true },
      { key: 'weekly_availability', label: 'Weekly availability', type: 'textarea', wide: true, placeholder: 'Mon–Fri 9–5, Sat mornings…' },
    ],
  },
  {
    // The card on file is asked right under this page's questions (the survey screen adds it).
    title: 'Services They Want Sent',
    fields: [
      { key: 'services', label: 'Services they offer', type: 'multi', wide: true,
        options: opts('Full Kitchens', 'Full Bathrooms', 'Partial Kitchens', 'Partial Bathrooms', 'Others') },
      { key: 'other_services', label: 'Other services they want', type: 'textarea', wide: true, when: a => has(a, 'services', 'Others') },
      { key: 'starting_prices', label: 'Starting prices', type: 'textarea', wide: true },
      { key: 'miles_out', label: 'How many miles out can they go for a job?', type: 'text' },
    ],
  },
  {
    title: 'Financing',
    fields: [
      { key: 'financing_leads', label: 'Send financing leads?', type: 'choice', options: opts('Yes', 'No') },
      { key: 'min_credit_score', label: 'Minimum credit score for financing leads', type: 'text', when: a => has(a, 'financing_leads', 'Yes') },
    ],
  },
  {
    title: 'The Business in Numbers',
    fields: [
      { key: 'years_in_business', label: 'Years in business', type: 'text' },
      { key: 'ad_spend', label: 'Ad spend', type: 'text', when: runsAds },
      { key: 'current_monthly_revenue', label: 'Current monthly revenue', type: 'text' },
      { key: 'goal_monthly_revenue', label: 'Goal monthly revenue', type: 'text' },
    ],
  },
];

/** Page one's questions — ours, carried by the client's link. */
export const SETUP_FIELDS: SurveyField[] = SURVEY_SECTIONS.filter(s => s.setup).flatMap(s => s.fields);
/** The pages the client fills in. */
export const CLIENT_SECTIONS: SurveySection[] = SURVEY_SECTIONS.filter(s => !s.setup);
/** The section the card on file sits under. */
export const CARD_AFTER = 'Services They Want Sent';

/** Just page one's answers. */
export function setupAnswers(a: Answers): Answers {
  const out: Answers = {};
  for (const f of SETUP_FIELDS) if (a[f.key] !== undefined) out[f.key] = a[f.key];
  return out;
}

/** What stops page one going out as a link. Null = fine. */
export function setupProblem(a: Answers): string | null {
  if (!serviceOf(a)) return 'Pick the service';
  if (a.price_per_appointment && priceOf(a) === null) return 'Price per appointment should be a number';
  if (a.prepaid_appointments && prepaidOf(a) === null) return 'Prepaid appointments should be a whole number';
  if (a.cash_collected && cashOf(a) === null) return 'Cash collected should be a number';
  return null;
}

/** What stops one page of the survey moving on. Null = fine. */
export function pageProblem(section: SurveySection, a: Answers): string | null {
  for (const f of section.fields) {
    if (f.when && !f.when(a)) continue;
    const v = a[f.key];
    const filled = Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '';
    if (f.required && !filled) return `${f.label} is needed`;
    if (f.type === 'email' && filled && !EMAIL.test(String(v).trim())) return `${f.label} doesn't look right`;
  }
  return null;
}

export const SURVEY_FIELDS: SurveyField[] = SURVEY_SECTIONS.flatMap(s => s.fields);
const BY_KEY = new Map(SURVEY_FIELDS.map(f => [f.key, f]));

/** Only the questions we ask, trimmed; anything else that was posted is dropped. */
export function cleanAnswers(input: unknown): Answers {
  const out: Answers = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const f = BY_KEY.get(key);
    if (!f) continue;
    if (f.type === 'multi') {
      const allowed = new Set((f.options ?? []).map(o => o.value));
      const picked = (Array.isArray(raw) ? raw : []).filter((v): v is string => typeof v === 'string' && allowed.has(v));
      if (picked.length) out[key] = picked;
    } else {
      const v = typeof raw === 'string' ? raw.trim().slice(0, f.type === 'textarea' ? 4000 : 400) : '';
      if (!v) continue;
      if (f.type === 'choice' && !(f.options ?? []).some(o => o.value === v)) continue;
      out[key] = v;
    }
  }
  // A follow-up whose question no longer applies is not kept.
  for (const f of SURVEY_FIELDS) if (f.when && !f.when(out)) delete out[f.key];
  return out;
}

/** What stops the survey being saved, in words. Null = fine. */
export function surveyProblem(a: Answers): string | null {
  for (const f of SURVEY_FIELDS) {
    if (f.required && !a[f.key]) return `${f.label} is needed`;
    if (f.type === 'email' && a[f.key] && !EMAIL.test(String(a[f.key]))) return `${f.label} doesn't look right`;
  }
  if (a.price_per_appointment && priceOf(a) === null) return 'Price per appointment should be a number';
  if (a.prepaid_appointments && prepaidOf(a) === null) return 'Prepaid appointments should be a whole number';
  if (a.cash_collected && cashOf(a) === null) return 'Cash collected should be a number';
  return null;
}

/** Appointments paid for up front. 0 = none; null = not a usable number. */
export function prepaidOf(a: Answers): number | null {
  const raw = str(a, 'prepaid_appointments');
  if (!raw) return 0;
  return /^\d{1,4}$/.test(raw) && Number(raw) <= 1000 ? Number(raw) : null;
}
/** Dollars collected on signing. 0 = none; null = not a usable number. */
export function cashOf(a: Answers): number | null {
  const raw = str(a, 'cash_collected');
  if (!raw) return 0;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return /^[$\s]*[\d,]+(\.\d{1,2})?\s*$/.test(raw) && Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
}

export const str = (a: Answers, key: string): string => (typeof a[key] === 'string' ? (a[key] as string) : '');
export type RosterService = 'facebook_ads' | 'sms' | 'both';
export const serviceOf = (a: Answers): RosterService | null => {
  const s = str(a, 'service');
  return s === 'facebook_ads' || s === 'sms' || s === 'both' ? s : null;
};
/** The checklists the survey opens: one card each. */
export const tracksOf = (a: Answers): Track[] => {
  const s = serviceOf(a);
  return s === 'both' ? ['facebook', 'sms'] : s === 'sms' ? ['sms'] : s === 'facebook_ads' ? ['facebook'] : [];
};
export function priceOf(a: Answers): number | null {
  const raw = str(a, 'price_per_appointment');
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return /\d/.test(raw) && Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}
export const contactName = (a: Answers) => [str(a, 'first_name'), str(a, 'last_name')].filter(Boolean).join(' ');
/** Where bills and receipts go: the business address if there is one. */
export const billingEmail = (a: Answers) => str(a, 'business_email') || str(a, 'personal_email');
export const mainPhone = (a: Answers) => str(a, 'business_phone') || str(a, 'personal_phone');

/** An answer as it reads on the card. */
export function showAnswer(f: SurveyField, a: Answers): string {
  const v = a[f.key];
  if (Array.isArray(v)) return v.join(', ');
  if (!v) return '';
  if (f.type === 'choice') return f.options?.find(o => o.value === v)?.label ?? v;
  if (f.type === 'money') return '$' + v;
  return v;
}
