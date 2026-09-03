export type NeighborhoodData = {
  name: string;
  deal_volume: number;
  median_income: number;
  home_value: number;
  owner_pct: number;
};

export type ZipMetrics = {
  zip: string;
  owner_pct: number;
  owner_units: number;
  median_income: number;
  median_year: number;
  population: number;
  home_value: number;
  prime_age_pct: number;
  recent_mover_pct: number;
  long_term_pct: number;
  mortgage_pct: number;
};

export type ScoredZip = ZipMetrics & {
  score: number;
  owner_score: number;
  income_score: number;
  age_score: number;
  home_value_score: number;
  prime_age_score: number;
  turnover_score: number;
  equity_score: number;
  long_term_score: number;
  mortgage_score: number;
  tier: "A" | "B" | "C" | "D";
};

function ownerScore(pct: number): number {
  return Math.min(pct * 1.25, 100);
}

function incomeScore(income: number): number {
  if (income <= 0) return 0;
  if (income < 40000)  return (income / 40000) * 20;
  if (income < 80000)  return 20 + ((income - 40000) / 40000) * 50;
  if (income < 160000) return 70 + ((income - 80000) / 80000) * 30;
  if (income < 250000) return 100 - ((income - 160000) / 90000) * 25;
  return Math.max(75 - ((income - 250000) / 200000) * 45, 30);
}

function homeValueScore(value: number): number {
  if (value <= 0)      return 40;
  if (value < 100000)  return 15;
  if (value < 200000)  return 40 + ((value - 100000)  / 100000) * 35;
  if (value < 350000)  return 75 + ((value - 200000)  / 150000) * 20;
  if (value < 600000)  return 95;
  if (value < 900000)  return 95 - ((value - 600000)  / 300000) * 30;
  return Math.max(65 - ((value - 900000) / 500000) * 40, 20);
}

function primeAgeScore(pct: number): number {
  // National avg ~25%; 20-30% is ideal K&B sweet spot
  if (pct <= 0) return 30;
  if (pct < 0.15) return (pct / 0.15) * 40;
  if (pct < 0.25) return 40 + ((pct - 0.15) / 0.10) * 60;
  if (pct < 0.35) return 100 - ((pct - 0.25) / 0.10) * 15;
  return Math.max(85 - ((pct - 0.35) / 0.15) * 25, 60);
}

function turnoverScore(pct: number): number {
  // Recent owner movers / total owner units; higher = more new buyers = near-term demand
  if (pct <= 0) return 20;
  if (pct < 0.10) return (pct / 0.10) * 40;
  if (pct < 0.20) return 40 + ((pct - 0.10) / 0.10) * 40;
  if (pct < 0.35) return 80 + ((pct - 0.20) / 0.15) * 20;
  return 100;
}

function equityScore(homeValue: number): number {
  // Higher value above national median ($230k) → more likely appreciated → equity to spend
  const MED = 230000;
  if (homeValue <= 0) return 30;
  if (homeValue < MED) return 20 + (homeValue / MED) * 30;
  if (homeValue < MED * 2) return 50 + ((homeValue - MED) / MED) * 40;
  return Math.min(90 + ((homeValue - MED * 2) / (MED * 3)) * 10, 100);
}

function longTermScore(pct: number): number {
  // 35-65% long-term residents (10+ yrs) is the K&B sweet spot
  if (pct <= 0) return 20;
  if (pct < 0.20) return 20 + (pct / 0.20) * 30;
  if (pct < 0.45) return 50 + ((pct - 0.20) / 0.25) * 40;
  if (pct < 0.65) return 90 + ((pct - 0.45) / 0.20) * 10;
  if (pct < 0.80) return 100 - ((pct - 0.65) / 0.15) * 15;
  return Math.max(85 - ((pct - 0.80) / 0.20) * 25, 60);
}

function mortgageScore(pct: number): number {
  // Sweet spot 55-80%: mid-life homeowners with equity to tap via cash-out refi
  if (pct <= 0) return 25;
  if (pct < 0.30) return 25 + (pct / 0.30) * 25;
  if (pct < 0.55) return 50 + ((pct - 0.30) / 0.25) * 35;
  if (pct < 0.78) return 85 + ((pct - 0.55) / 0.23) * 15;
  if (pct < 0.90) return 100 - ((pct - 0.78) / 0.12) * 20;
  return Math.max(80 - ((pct - 0.90) / 0.10) * 30, 50);
}

function homeAgeScore(medianYear: number): number {
  if (medianYear <= 0) return 50;
  const age = 2025 - medianYear;
  if (age < 8)  return age * 5;
  if (age < 20) return 40 + (age - 8) * 5;
  if (age < 50) return 100;
  if (age < 70) return 100 - (age - 50) * 1.5;
  return Math.max(70 - (age - 70) * 2, 15);
}

export function scoreZip(m: ZipMetrics): ScoredZip {
  const os  = Math.round(ownerScore(m.owner_pct));
  const is_ = Math.round(incomeScore(m.median_income));
  const as_ = Math.round(homeAgeScore(m.median_year));
  const vs_ = Math.round(homeValueScore(m.home_value));
  const primePct   = m.prime_age_pct   > 0 ? m.prime_age_pct   : 0.25;
  const moverPct   = m.recent_mover_pct > 0 ? m.recent_mover_pct : 0.15;
  const ltPct      = m.long_term_pct   > 0 ? m.long_term_pct   : 0.45;
  const mortPct    = m.mortgage_pct    > 0 ? m.mortgage_pct    : 0.65;
  const pas  = Math.round(primeAgeScore(primePct));
  const ts   = Math.round(turnoverScore(moverPct));
  const es   = Math.round(equityScore(m.home_value));
  const lts  = Math.round(longTermScore(ltPct));
  const ms   = Math.round(mortgageScore(mortPct));
  // Weights: owner_occ 18 + income 18 + home_age 13 + home_value 13 + prime_age 13 + turnover 9 + equity 4 + long_term 7 + mortgage 5 = 100
  const score = Math.round(
    0.18 * os + 0.18 * is_ + 0.13 * as_ + 0.13 * vs_ + 0.13 * pas +
    0.09 * ts + 0.04 * es + 0.07 * lts + 0.05 * ms
  );
  const tier: ScoredZip["tier"] = score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D";
  return { ...m, score, owner_score: os, income_score: is_, age_score: as_, home_value_score: vs_, prime_age_score: pas, turnover_score: ts, equity_score: es, long_term_score: lts, mortgage_score: ms, tier };
}

export function estimateROI(census_est: number, home_value: number): {
  avg_ticket: number; close_rate: number; total_addressable_revenue: number;
} {
  const avg_ticket = home_value <= 0 ? 25000 : home_value < 200000 ? 18000 :
    home_value < 400000 ? 32000 : home_value < 700000 ? 55000 : 85000;
  const close_rate = 0.18; // industry contractor close rate
  return { avg_ticket, close_rate, total_addressable_revenue: Math.round(census_est * close_rate * avg_ticket) };
}

export function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

// Three-stop: soft mint → bright yellow → rich amber-gold
export function incomeToColor(income: number, minIncome: number, maxIncome: number): string {
  if (income <= 0 || maxIncome <= minIncome) return "#a7f3d0";
  const t = Math.max(0, Math.min(1, (income - minIncome) / (maxIncome - minIncome)));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(167 + u * (253 - 167));
    g = Math.round(243 + u * (224 - 243));
    b = Math.round(208 + u * (71  - 208));
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(253 + u * (217 - 253));
    g = Math.round(224 + u * (119 - 224));
    b = Math.round(71  + u * (6   - 71));
  }
  return `rgb(${r},${g},${b})`;
}

export function estimateDealVolume(owner_units: number, income: number, median_year: number): number {
  if (owner_units <= 0) return 0;
  const incomeFactor =
    income < 40000  ? 0.35 :
    income < 70000  ? 0.70 :
    income < 100000 ? 0.88 :
    income < 160000 ? 1.00 :
    income < 250000 ? 0.82 : 0.65;
  const age = 2025 - (median_year > 1900 ? median_year : 1985);
  const ageFactor =
    age < 10 ? 0.25 :
    age < 20 ? 0.60 :
    age < 40 ? 1.00 :
    age < 55 ? 0.88 :
    age < 70 ? 0.75 : 0.60;
  // 4.5% = contractor-performed K&B renovation rate (NKBA 2023; excludes DIY)
  return Math.round(owner_units * 0.045 * incomeFactor * ageFactor);
}

export function volumeToRadius(units: number, minUnits: number, maxUnits: number): number {
  const MIN_R = 9, MAX_R = 38;
  if (maxUnits <= minUnits || units <= 0) return MIN_R;
  const logMin = Math.log1p(minUnits);
  const logMax = Math.log1p(maxUnits);
  const t = Math.max(0, Math.min(1, (Math.log1p(units) - logMin) / (logMax - logMin)));
  return Math.round(MIN_R + t * (MAX_R - MIN_R));
}

export type ZipPerfInput = {
  leads: number;
  appointments: number;
  shows: number;
  closes: number;
  revenue: number;
};

// How a zip earns its grade: quality first. Close rate carries the most weight,
// then how well leads turn into appointments, and volume last — enough to keep a
// one-lead zip from topping the territory, not enough to let raw size win.
const CLOSE_RATE_WEIGHT = 0.55;
const APPT_RATE_WEIGHT  = 0.30;
const VOLUME_WEIGHT     = 0.15;

// Rates from thin zips are mostly noise: one lead that closed is not a 100% close
// rate. Each rate is pulled toward the territory's own average as if the zip had
// this many extra average-performing leads, so a zip has to earn its way out.
const RATE_PRIOR = 5;

function smoothedRate(hits: number, base: number, average: number): number {
  return (hits + RATE_PRIOR * average) / (base + RATE_PRIOR);
}

// Leads sometimes arrive without a zip while the appointment or close that follows
// has one, so the funnel's widest stage is the honest denominator.
function funnelBase(r: ZipPerfInput): number {
  return Math.max(r.leads, r.appointments, r.shows, r.closes, 0);
}

// Composite 0-100 performance score per zip — quality-weighted, then curved against
// the other zips in the same territory so the grades spread across the map instead
// of everything but the biggest zip landing in the red.
export function scorePerformanceZips(rows: Record<string, ZipPerfInput>): Record<string, number> {
  const zips = Object.keys(rows);
  if (!zips.length) return {};

  // Territory averages — what a typical zip here converts at.
  let totalBase = 0, totalAppts = 0, totalCloses = 0;
  for (const z of zips) {
    totalBase   += funnelBase(rows[z]);
    totalAppts  += rows[z].appointments;
    totalCloses += rows[z].closes;
  }
  const avgCloseRate = totalBase > 0 ? totalCloses / totalBase : 0;
  const avgApptRate  = totalBase > 0 ? totalAppts  / totalBase : 0;
  const maxBase      = Math.max(...zips.map(z => funnelBase(rows[z])));

  const raw: Record<string, number> = {};
  for (const z of zips) {
    const r    = rows[z];
    const base = funnelBase(r);
    raw[z] =
      CLOSE_RATE_WEIGHT * smoothedRate(r.closes,       base, avgCloseRate) +
      APPT_RATE_WEIGHT  * smoothedRate(r.appointments, base, avgApptRate)  +
      VOLUME_WEIGHT     * (maxBase > 0 ? base / maxBase : 0);
  }

  // Curve: a zip's score is where it places among its neighbours, not its distance
  // from the single best one. Ties share the average of the places they occupy.
  const order = [...zips].sort((a, b) => raw[a] - raw[b]);
  const scores: Record<string, number> = {};

  if (order.length === 1) {
    scores[order[0]] = raw[order[0]] > 0 ? 100 : 0;
    return scores;
  }

  for (let i = 0; i < order.length; i++) {
    let j = i;
    while (j + 1 < order.length && raw[order[j + 1]] === raw[order[i]]) j++;
    const place = (i + j) / 2;
    // One decimal place: whole numbers collide constantly across a territory of
    // 100+ zips, which flattens the ranking and makes the map look banded.
    const score = Math.round((place / (order.length - 1)) * 1000) / 10;
    for (let k = i; k <= j; k++) scores[order[k]] = score;
    i = j;
  }

  return scores;
}

// Performance score → letter grade. The score is a placing within the territory
// rather than a raw number, so the bands are set by how much of the map each
// colour should cover: the top fifth green, the bottom fifth red, the middle 60%
// split between them. Borrowing the Census score's cut-offs here painted a third
// of every territory red no matter how well its zips converted.
export function perfGrade(score: number): "A" | "B" | "C" | "D" {
  return score >= 80 ? "A" : score >= 50 ? "B" : score >= 20 ? "C" : "D";
}

// Maps a 0-100 composite performance score to a pixel radius for the map circle overlay.
export function scoreToRadius(score: number): number {
  const MIN_R = 6, MAX_R = 30;
  const t = Math.max(0, Math.min(100, score)) / 100;
  return Math.round(MIN_R + t * (MAX_R - MIN_R));
}
