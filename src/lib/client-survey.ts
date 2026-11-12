// New client survey (Clients > Onboarding) — the questions, and what counts as
// a usable answer. Pure: the form (browser) and the API both read this file.
//
// The questions mirror the GHL onboarding form the owner used before, with two
// differences: it asks which service we are setting up (the form never did, and
// the roster, the checklist and billing all need it), and it never asks for a
// card number. Cards go on file through Stripe's own page (see NOTES.md
// 2026-11-12) — a card number and CVC typed into our database is something we
// must not hold.

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
const has = (a: Answers, key: string, value: string) => Array.isArray(a[key]) ? (a[key] as string[]).includes(value) : a[key] === value;

export const SURVEY_SECTIONS: { title: string; note?: string; fields: SurveyField[] }[] = [
  {
    title: 'What we are setting up',
    fields: [
      { key: 'service', label: 'Service', type: 'choice', required: true, wide: true,
        options: [{ value: 'facebook_ads', label: 'Facebook Ads' }, { value: 'sms', label: 'SMS' }, { value: 'both', label: 'Both' }] },
      { key: 'price_per_appointment', label: 'Price per appointment', type: 'money', placeholder: '0', hint: 'Goes to Client Billing. Leave empty to set it later.' },
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
      { key: 'business_name', label: 'Business name', type: 'text', required: true, wide: true, hint: 'This becomes the client name everywhere — keep it exactly as GHL sends it.' },
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
    title: 'Services they want sent',
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
    title: 'The business in numbers',
    fields: [
      { key: 'years_in_business', label: 'Years in business', type: 'text' },
      { key: 'ad_spend', label: 'Ad spend', type: 'text' },
      { key: 'current_monthly_revenue', label: 'Current monthly revenue', type: 'text' },
      { key: 'goal_monthly_revenue', label: 'Goal monthly revenue', type: 'text' },
    ],
  },
];

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

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What stops the survey being saved, in words. Null = fine. */
export function surveyProblem(a: Answers): string | null {
  for (const f of SURVEY_FIELDS) {
    if (f.required && !a[f.key]) return `${f.label} is needed`;
    if (f.type === 'email' && a[f.key] && !EMAIL.test(String(a[f.key]))) return `${f.label} doesn't look right`;
  }
  if (a.price_per_appointment && priceOf(a) === null) return 'Price per appointment should be a number';
  return null;
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
