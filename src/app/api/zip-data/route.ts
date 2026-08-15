import { NextResponse } from 'next/server';
import { scoreZip, estimateDealVolume, estimateROI } from '@/lib/zip-score';

const CENSUS_KEY = process.env.CENSUS_API_KEY ?? '';
const VARS = 'B25003_001E,B25003_002E,B19013_001E,B25035_001E,B01003_001E,B25077_001E,B01001_001E,B01001_014E,B01001_015E,B01001_016E,B01001_017E,B01001_018E,B01001_038E,B01001_039E,B01001_040E,B01001_041E,B01001_042E,B25038_003E,B25038_004E,B25038_005E,B25038_006E,B25038_007E,B25082_001E,B25082_002E';

const cache = new Map<string, { ts: number; data: object }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ~42% of remodeling jobs are digitally discovered (Harvard JCHS 2023 supplement)
const DIGITAL_RATE = 0.42;

// Platform market shares of digital-originated K&B jobs (estimated from IAC/Angi annual reports,
// Thumbtack investor disclosures, Houzz Industry Study 2023, Yelp Economic Average)
const PLATFORMS = [
  {
    name: "Angi / HomeAdvisor",
    share: 0.35,
    color: "#f97316",
    description: "Largest US home services marketplace (Angi Inc.). Processes an estimated $20B+ in annual home service requests. Kitchen & bath remodeling is their #1 category by volume.",
    source: "Angi Inc. Annual Report 2023",
  },
  {
    name: "Thumbtack",
    share: 0.20,
    color: "#8b5cf6",
    description: "On-demand professional marketplace. Reported ~$5B in service requests in 2022. Kitchen and bath remodels represent roughly 10–12% of their category mix.",
    source: "Thumbtack Economic Impact Report 2022",
  },
  {
    name: "Houzz Pro",
    share: 0.15,
    color: "#10b981",
    description: "Design-focused platform attracting higher-income homeowners. Strong in kitchen remodels $30K+. Their 2023 Industry Study reports 1.7M+ active professionals.",
    source: "Houzz Kitchen Trends Study 2023",
  },
  {
    name: "Yelp Home Services",
    share: 0.12,
    color: "#ef4444",
    description: "Review-driven leads from high-intent searchers. Home services is Yelp's #2 revenue category. Customers who research on Yelp convert at ~2× the industry average.",
    source: "Yelp Economic Average 2023",
  },
  {
    name: "Porch / Lowe's",
    share: 0.09,
    color: "#06b6d4",
    description: "Connected to Lowe's in-store experience — captures homeowners at the point of material purchase. Strong leading indicator of kitchen & bath intent.",
    source: "Porch Group Investor Presentation 2023",
  },
  {
    name: "Other Platforms",
    share: 0.09,
    color: "#64748b",
    description: "Includes BuildZoom, HomeGuide, Bark.com, Networx, and emerging AI-driven lead platforms. Combined share growing ~8% annually.",
    source: "IBISWorld Home Services Marketplace Report 2024",
  },
];

async function fetchZctaACS(zip: string) {
  const url = `https://api.census.gov/data/2022/acs/acs5?get=${VARS}&for=zip%20code%20tabulation%20area:${zip}&key=${CENSUS_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  let rows: string[][];
  try { rows = await r.json(); } catch { return null; }
  if (rows.length < 2) return null;

  const headers = rows[0];
  const row = rows[1];
  const col = (name: string) => headers.indexOf(name);

  const total_units = parseInt(row[col('B25003_001E')]) || 0;
  const owner_units = parseInt(row[col('B25003_002E')]) || 0;
  const income      = parseInt(row[col('B19013_001E')]) || 0;
  const med_year    = parseInt(row[col('B25035_001E')]) || 0;
  const pop         = parseInt(row[col('B01003_001E')]) || 0;
  const home_value  = parseInt(row[col('B25077_001E')]) || 0;

  const age_pop   = parseInt(row[col('B01001_001E')]) || 0;
  const age_45_64 = ['B01001_014E','B01001_015E','B01001_016E','B01001_017E','B01001_018E',
    'B01001_038E','B01001_039E','B01001_040E','B01001_041E','B01001_042E']
    .reduce((s, v) => s + (parseInt(row[col(v)]) || 0), 0);
  const prime_age_pct = age_pop > 0 ? age_45_64 / age_pop : 0;
  const recent_movers = (parseInt(row[col('B25038_003E')]) || 0) + (parseInt(row[col('B25038_004E')]) || 0);
  const recent_mover_pct = owner_units > 0 ? recent_movers / owner_units : 0;

  // Long-term residents: owner-occupied units where householder moved in 10+ years ago
  const long_term_units = (parseInt(row[col('B25038_005E')]) || 0)  // 2010-2014 (8-14 yrs)
    + (parseInt(row[col('B25038_006E')]) || 0)   // 2000-2009 (13-22 yrs)
    + (parseInt(row[col('B25038_007E')]) || 0);  // 1999 or earlier (23+ yrs)
  const long_term_pct = owner_units > 0 ? long_term_units / owner_units : 0;

  // Mortgage penetration: value-weighted proxy via aggregate home-value table B25082
  const agg_total     = parseInt(row[col('B25082_001E')]) || 0;
  const agg_mortgaged = parseInt(row[col('B25082_002E')]) || 0;
  const mortgage_pct  = agg_total > 0 && agg_mortgaged >= 0 ? Math.min(agg_mortgaged / agg_total, 1) : 0;

  return {
    zip,
    owner_pct:        total_units > 0 ? (owner_units / total_units) * 100 : 0,
    owner_units,
    median_income:    income > 0 ? income : 0,
    median_year:      med_year > 0 ? med_year : 0,
    population:       pop,
    home_value:       home_value > 0 ? home_value : 0,
    prime_age_pct,
    recent_mover_pct,
    long_term_pct,
    mortgage_pct,
  };
}

async function fetchACS2017Value(zip: string): Promise<number> {
  try {
    const url = `https://api.census.gov/data/2017/acs/acs5?get=B25077_001E&for=zip%20code%20tabulation%20area:${zip}&key=${CENSUS_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return 0;
    const rows: string[][] = await r.json();
    if (rows.length < 2) return 0;
    return parseInt(rows[1][0]) || 0;
  } catch { return 0; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get('zip')?.trim();

  if (!zip || !/^\d{5}$/.test(zip))
    return NextResponse.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  if (!CENSUS_KEY)
    return NextResponse.json({ error: 'CENSUS_API_KEY not configured' }, { status: 500 });

  const cached = cache.get(zip);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return NextResponse.json(cached.data);

  const [metrics, value2017] = await Promise.all([
    fetchZctaACS(zip),
    fetchACS2017Value(zip),
  ]);
  if (!metrics) return NextResponse.json({ error: `No Census data for zip ${zip}` }, { status: 404 });

  const appreciation_5yr = (value2017 > 0 && metrics.home_value > 0)
    ? (metrics.home_value - value2017) / value2017
    : null;

  const scored     = scoreZip(metrics);
  const census_est = estimateDealVolume(metrics.owner_units, metrics.median_income, metrics.median_year);
  const digital    = Math.round(census_est * DIGITAL_RATE);
  const roi        = estimateROI(census_est, metrics.home_value);

  const platforms = PLATFORMS.map(p => ({
    name:        p.name,
    color:       p.color,
    jobs:        Math.round(digital * p.share),
    share_pct:   Math.round(p.share * 100),
    description: p.description,
    source:      p.source,
  }));

  // Market density: estimated jobs per 1,000 residents — higher = more active renovation market
  const market_density = metrics.population > 0
    ? Math.round((census_est / metrics.population) * 1000 * 10) / 10
    : 0;

  const result = {
    zip,
    median_income:     metrics.median_income,
    home_value:        metrics.home_value,
    owner_pct:         Math.round(metrics.owner_pct * 10) / 10,
    owner_units:       metrics.owner_units,
    population:        metrics.population,
    median_year:       metrics.median_year > 0 ? metrics.median_year : null,
    prime_age_pct:     metrics.prime_age_pct,
    recent_mover_pct:  metrics.recent_mover_pct,
    long_term_pct:     metrics.long_term_pct,
    mortgage_pct:      metrics.mortgage_pct,
    appreciation_5yr,
    score:             scored.score,
    grade:             scored.tier,
    score_breakdown: {
      income:     scored.income_score,
      owner_occ:  scored.owner_score,
      home_value: scored.home_value_score,
      home_age:   scored.age_score,
      prime_age:  scored.prime_age_score,
      turnover:   scored.turnover_score,
      equity:     scored.equity_score,
      long_term:  scored.long_term_score,
      mortgage:   scored.mortgage_score,
    },
    job_volume: {
      total_est:        census_est,
      digital_est:      digital,
      digital_rate_pct: Math.round(DIGITAL_RATE * 100),
      market_density,
      platforms,
    },
    roi,
  };

  cache.set(zip, { ts: Date.now(), data: result });
  return NextResponse.json(result);
}
