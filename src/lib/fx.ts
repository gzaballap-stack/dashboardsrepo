// USD → EUR exchange rate for Profit and Loss.
//
// Every line is stored with the rate of the day it was entered, so switching
// the sheet between dollars and euros never rewrites history: an old line
// converts at its own rate, not today's. The rate is the ECB reference rate
// (frankfurter.dev, no key). If that can't be reached, the most recent rate
// already stored is used; failing that the line is saved without one and is
// shown as entered until a rate exists.

import type { createServiceClient } from './supabase';

const SOURCE = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR';

let cache: { day: string; rate: number } | null = null;

export async function getUsdEurRate(service: ReturnType<typeof createServiceClient>): Promise<number | null> {
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
  } catch { /* fall through to the last stored rate */ }

  const { data } = await service
    .from('pnl_lines').select('usd_eur_rate')
    .not('usd_eur_rate', 'is', null)
    .order('created_at', { ascending: false }).limit(1);
  const last = Number(data?.[0]?.usd_eur_rate);
  return Number.isFinite(last) && last > 0 ? last : null;
}
