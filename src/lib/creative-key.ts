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
 * The creative code at the front of a name — "AI-007 Kitchen Made of Money" →
 * "AI-007". Types: TH talking head · UGC · VO voiceover · AI absurd AI image ·
 * RI realistic AI image · IMG designed static / photo · AIV AI video · CAR
 * carousel. Three digits, optional variant letter (IMG-002b).
 */
export const CODE_TYPES = ['TH', 'UGC', 'VO', 'AI', 'RI', 'IMG', 'AIV', 'CAR'] as const;
const CODE_RE = new RegExp(`^(${CODE_TYPES.join('|')})-(\\d{3})([a-z])?(?![\\w-])`, 'i');

export function codeOf(name: string): string | null {
  const m = name.trim().match(CODE_RE);
  return m ? `${m[1].toUpperCase()}-${m[2]}${(m[3] ?? '').toLowerCase()}` : null;
}

/** True when the whole string is a well-formed code. */
export function isCode(s: string): boolean {
  return codeOf(s) === s.trim() && !/\s/.test(s.trim());
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
