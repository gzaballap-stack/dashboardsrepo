// How a creative's name is folded into one identity. Shared by the creative
// leaderboard and the Creative & Copy Hub so a hub entry and its leaderboard
// row are always the same creative.

// Ad names get "– Copy", " - Copy 2", trailing whitespace and case drift as they
// are duplicated between accounts. Fold those so one creative stays one row.
export function normaliseName(raw: string): string {
  return raw
    .replace(/\s*[–—-]\s*copy(\s*\d+)?\s*$/i, '')
    .replace(/\s*\(\s*copy(\s*\d+)?\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grouping key that ignores word order.
 *
 * The same creative gets typed differently between accounts — "Bathroom Script
 * 12" and "Script 12 Bathroom" are one piece of work. Sorting the tokens makes
 * both collapse to "12 bathroom script".
 *
 * This is deliberately order-insensitive but still exact on the words
 * themselves, so "Bathroom Script 10" and "Bathroom Script 12" stay apart — the
 * distinguishing token differs. Every pooled spelling is returned on the row so
 * an unintended merge is visible rather than silent.
 */
export function poolKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Categories a creative is filed under. The code is the category, the folder
 * inside it (optional) and a running number: AI/SLOP/001, TH/004.
 */
export const CATEGORIES = [
  { code: 'AI',  label: 'AI image' },
  { code: 'TH',  label: 'Talking head' },
  { code: 'UGC', label: 'UGC' },
  { code: 'VO',  label: 'Voiceover' },
] as const;
export type CategoryCode = (typeof CATEGORIES)[number]['code'];
export const CATEGORY_CODES = CATEGORIES.map(c => c.code) as readonly string[];
export const categoryLabel = (code: string | null | undefined) =>
  CATEGORIES.find(c => c.code === code)?.label ?? code ?? 'Uncategorised';

const CODE_RE = new RegExp(`^(${CATEGORY_CODES.join('|')})(?:/([A-Z0-9][A-Z0-9-]*))?/(\\d{1,3})([a-z])?(?![\\w/-])`, 'i');

/** "AI/SLOP/001 Dog Driving" → "AI/SLOP/001"; null when the name carries no code. */
export function codeOf(name: string): string | null {
  const m = name.trim().match(CODE_RE);
  if (!m) return null;
  return buildCode(m[1].toUpperCase(), m[2]?.toUpperCase() ?? null, Number(m[3])) + (m[4] ?? '').toLowerCase();
}

export function buildCode(category: string, folderSlug: string | null, seq: number): string {
  return [category, folderSlug, String(seq).padStart(3, '0')].filter(Boolean).join('/');
}

/** The folder part of a code, from its name: "Realistic images" → "REALISTIC" (first word, 12 chars max). */
export function folderSlug(name: string): string {
  return (name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')[0] ?? '').slice(0, 12);
}

/**
 * The key a creative is filed under, never empty. A name that starts with a
 * creative code is filed under the code alone, so renaming the rest of the ad
 * name in Meta never splits its history.
 *
 * Across clients (`ordered` off) word order is ignored, as above. Inside a
 * single account (`ordered` on — Tomsi Media's own B2B ads) there is no
 * cross-account spelling drift to absorb, and ignoring order would be wrong:
 * "Hook 1 Body 2" and "Hook 2 Body 1" are different ads made of the same words.
 */
export function creativeKey(rawName: string, ordered = false): string {
  const code = codeOf(rawName);
  if (code) return code.toLowerCase();
  const name = normaliseName(rawName);
  if (ordered) return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || name.toLowerCase();
  return poolKey(name) || name.toLowerCase();
}
