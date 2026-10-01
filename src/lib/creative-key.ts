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
 * The key a creative is filed under, never empty.
 *
 * Across clients (`ordered` off) word order is ignored, as above. Inside a
 * single account (`ordered` on — Tomsi Media's own B2B ads) there is no
 * cross-account spelling drift to absorb, and ignoring order would be wrong:
 * "Hook 1 Body 2" and "Hook 2 Body 1" are different ads made of the same words.
 */
export function creativeKey(rawName: string, ordered = false): string {
  const name = normaliseName(rawName);
  if (ordered) return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || name.toLowerCase();
  return poolKey(name) || name.toLowerCase();
}
