// Today's USD → EUR rate, for expenses typed in euros on Profit and Loss.
//
// Amounts are stored in dollars only. When a figure is typed in euros it is
// converted once, as it is saved, at this rate — the ECB reference rate from
// frankfurter.dev (no key), cached for the day. Nothing is remembered about
// the conversion afterwards; the dollar figure is the record.

const SOURCE = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR';

let cache: { day: string; rate: number } | null = null;

/** EUR per 1 USD today, or null if the rate service can't be reached. */
export async function getUsdEurRate(): Promise<number | null> {
  const day = new Date().toISOString().slice(0, 10);
  if (cache?.day === day) return cache.rate;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    const body = await res.json();
    const rate = Number(body?.rates?.EUR);
    if (res.ok && Number.isFinite(rate) && rate > 0) {
      cache = { day, rate };
      return rate;
    }
  } catch { /* unreachable: the caller decides what to do without a rate */ }
  return cache?.rate ?? null;
}
