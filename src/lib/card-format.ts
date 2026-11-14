// Card details as typed — tidying and checking them. Pure: the form (browser)
// and the card vault (server) both use it. Nothing here stores anything.

export type CardInput = { name: string; number: string; exp: string; cvc: string; zip: string };
export const EMPTY_CARD: CardInput = { name: '', number: '', exp: '', cvc: '', zip: '' };

export const digits = (s: string) => (s ?? '').replace(/\D/g, '');
export const cardStarted = (c: CardInput) => !!(c.name.trim() || digits(c.number) || digits(c.exp) || digits(c.cvc) || c.zip.trim());

/** The check digit every real card number carries — catches a mistyped digit. */
export function luhn(number: string): boolean {
  const d = digits(number);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export function brandOf(number: string): string {
  const d = digits(number);
  const two = Number(d.slice(0, 2)), four = Number(d.slice(0, 4));
  if (d.startsWith('4')) return 'Visa';
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'Mastercard';
  if (two === 34 || two === 37) return 'Amex';
  if (d.startsWith('6011') || two === 65) return 'Discover';
  return 'Card';
}

/** 4242 4242 4242 4242 (Amex: 3782 822463 10005). */
export function formatNumber(raw: string): string {
  const d = digits(raw).slice(0, 19);
  if (brandOf(d) === 'Amex') return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  return d.replace(/(.{4})/g, '$1 ').trim();
}

/** Whatever was typed, as MM/YY. */
export function formatExp(raw: string): string {
  let d = digits(raw);
  if (d.length === 1 && Number(d) > 1) d = `0${d}`;
  // 12/2028 typed in full
  if (d.length === 6) d = d.slice(0, 2) + d.slice(4);
  d = d.slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** The card as it is stored: digits only, expiry as MM/YY. */
export function tidyCard(c: CardInput): CardInput {
  return {
    name: (c.name ?? '').trim().slice(0, 120), number: digits(c.number), exp: formatExp(c.exp ?? ''),
    cvc: digits(c.cvc).slice(0, 4), zip: (c.zip ?? '').trim().slice(0, 12),
  };
}

/** What is wrong with it, in words. Null = fine. */
export function cardProblem(input: CardInput, today = new Date()): string | null {
  const c = tidyCard(input);
  if (!c.number) return 'The card number is missing';
  if (!luhn(c.number)) return "That card number isn't valid — check the digits";
  const m = c.exp.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return 'The expiry should read MM/YY';
  const month = Number(m[1]), year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return 'The expiry month should be 01 to 12';
  if (year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth() + 1)) return 'That card has expired';
  const want = brandOf(c.number) === 'Amex' ? 4 : 3;
  if (c.cvc.length !== want) return `The security code should be ${want} digits`;
  return null;
}
