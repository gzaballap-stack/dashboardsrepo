// Client copy packs (NOTES.md 2026-11-23). One B2C copy set in the Creative &
// Copy Hub is the **active template**: its texts carry blanks — {company},
// {first_name}, {city}, {state}, {bath_price}, {kitchen_price} — and every new
// Facebook client gets a copy of it with the blanks filled in from their survey
// (lib/client-setup.ts). Shared by the server and the Copy page (the blank list).

import { str, type Answers } from './client-survey';

export const BLANKS: { key: string; label: string }[] = [
  { key: 'company', label: 'Business name' },
  { key: 'first_name', label: "Owner's first name" },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'bath_price', label: 'Bathroom ad price, e.g. $14997' },
  { key: 'kitchen_price', label: 'Kitchen ad price, e.g. $17997' },
];

/**
 * A starting price written any way the survey allows — "Full Bathroom: 15k",
 * "Baths $10k-$30k", "Bathroom 15,000 to 40,000", "Kitchens: 35 -40k" — read
 * for one kind of job. Partial jobs are skipped. The first number after the
 * word counts; under 1000 it is taken as thousands. Null when there is none.
 */
export function startingPrice(text: string, kind: 'bath' | 'kitchen'): number | null {
  const words = [...text.matchAll(/(partial\s+)?(bath|kitchen)\w*/gi)];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w[1] || !w[2].toLowerCase().startsWith(kind)) continue;
    const from = (w.index ?? 0) + w[0].length;
    const to = i + 1 < words.length ? words[i + 1].index ?? text.length : text.length;
    const m = text.slice(from, to).match(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i);
    if (!m) continue;
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) n *= 1000;
    else if (n < 1000) n *= 1000;
    if (n > 0) return n;
  }
  return null;
}

/** How the ads write a price: just under the next thousand — 15k → $14997, 8.5k → $8997. */
export const adPrice = (n: number) => `$${Math.ceil(n / 1000) * 1000 - 3}`;

/** The blanks for one client. A price the survey does not give falls back to the other one. */
export function blanksFor(a: Answers): { values: Record<string, string>; missing: string[] } {
  const prices = str(a, 'starting_prices');
  const bath = startingPrice(prices, 'bath');
  const kitchen = startingPrice(prices, 'kitchen');
  const values: Record<string, string> = {
    company: str(a, 'business_name').trim(),
    first_name: str(a, 'first_name').trim(),
    city: str(a, 'city').trim(),
    state: str(a, 'state').trim(),
  };
  const b = bath ?? kitchen, k = kitchen ?? bath;
  if (b) values.bath_price = adPrice(b);
  if (k) values.kitchen_price = adPrice(k);
  const missing = BLANKS.filter(x => !values[x.key]).map(x => x.label);
  return { values, missing };
}

/** Fills the blanks; one the client has no answer for is left as it is, so it shows. */
export const fillBlanks = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] || all);

/**
 * The first active template, built from the client ads running in November
 * 2026 (price shock, branded bathroom / kitchen, homeowners intro, us vs them).
 * Made in the database the first time it is needed; edited on the Copy page.
 */
export const STARTER_TEMPLATE = {
  name: 'New Client Pack',
  campaign_label: 'Template',
  notes: 'The active template: every new Facebook client gets a copy of this with the blanks filled in from their survey. Blanks: {company} {first_name} {city} {state} {bath_price} {kitchen_price}.',
  cta: 'LEARN_MORE',
  bodies: [
    `The price of a remodel in 2026 might shock you

We just quoted this {city} homeowner {bath_price} for their Bathroom remodel with transparent pricing, friendly experts, and zero pressure.

Curious what your remodel could cost?

Click below to claim your free estimate while spots are still open.`,
    `{bath_price} for a full bathroom remodel?

Sure, it depends on the size and scope.

Some bathrooms run $25k, $40k, even $60k+.

But our remodels are more affordable than most of our competitors.

Here’s why:

We’re not a massive remodeling company with 20 trucks, a fancy showroom, and a huge sales team.

We run lean — just a tight crew that does the work right the first time.

We use smart marketing, keep our overhead low, and focus on craftsmanship, not commissions.

Less fluff for us.

Better prices for you.

And yes — we still use premium materials

Want a fair price for your remodel?

Click the "Learn More" button below.`,
    `{kitchen_price} for a full Kitchen remodel?

Sure, it depends on the size and scope.

Some kitchens run $25k, $40k, even $60k+.

But our remodels are more affordable than most of our competitors.

Here’s why:

We’re not a massive remodeling company with 20 trucks, a fancy showroom, and a huge sales team.

We run lean — just a tight crew that does the work right the first time.

We use smart marketing, keep our overhead low, and focus on craftsmanship, not commissions.

Less fluff for us.

Better prices for you.

And yes — we still use premium materials

Want a fair price for your remodel?

Click the "Learn More" button below.`,
    `{city} Homeowners – Want to Fall Back in Love With Your Home? At {company}, we specialize in turning outdated kitchens and bathrooms into dream spaces — beautifully built and stress-free.

Our Remodels Start At Just {bath_price}

Imagine walking into a kitchen perfect for hosting, or a spa-like bathroom that feels like a retreat. A high-quality remodel not only elevates your lifestyle — it boosts your home’s value too.

We make the process simple — from concept to completion — with no-pressure consultations and a licensed, professional team that gets it done right the first time.

Tap “Learn More” to claim your bonus and schedule your free estimate today.`,
    `Are you fed up with paying way more than you should for a remodel?

Hidden fees. Pushy sales tactics.

And in the end—you’re left 𝗼𝘃𝗲𝗿𝗽𝗮𝘆𝗶𝗻𝗴 by 𝘁𝗵𝗼𝘂𝘀𝗮𝗻𝗱𝘀 𝗼𝗳 𝗱𝗼𝗹𝗹𝗮𝗿𝘀.

We’ve got the solution.

The homeowners in this photo saved $4,500 on their remodel for one simple reason:

𝗙𝗮𝗶𝗿 𝗽𝗿𝗶𝗰𝗶𝗻𝗴.

Here’s the thing…

When you get quotes for a new kitchen or bathroom, the prices are usually all over the place.

Almost always higher than they should be.

Why?

Because the big companies are weighed down by overhead:

🏢 Fancy showrooms
🚛 Fleets of trucks
📺 Pricey billboards & TV ads

𝗕𝗼𝘁𝘁𝗼𝗺 𝗹𝗶𝗻𝗲:

The one covering all that overhead is 𝙔𝙊𝙐, the homeowner.

Not cool. Not fair.

Not at ALL how we do things.

My name is {first_name}, and I run a lean remodeling company built on:

✅ No High-Pressure Sales
✅ Premium Materials
✅ Honest, Affordable Pricing

Instead of inflating costs, we pass the savings on to YOU.

Click “Learn More” now to see how much you could save on your dream kitchen or bathroom.`,
  ],
  headlines: [
    'Full Remodels Starting at {bath_price}?',
    'Remodel for LESS? Find Out How! 🔥',
  ],
  descriptions: ['4.9⭐⭐⭐⭐⭐(267)'],
};
