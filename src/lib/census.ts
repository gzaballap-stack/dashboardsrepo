import { scoreZip, type ZipMetrics } from '@/lib/zip-score';

const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';
const CENSUS_KEY = process.env.CENSUS_API_KEY ?? '';
const ACS_VARS = 'B25003_001E,B25003_002E,B19013_001E,B25035_001E,B01003_001E,B25077_001E,B01001_001E,B01001_014E,B01001_015E,B01001_016E,B01001_017E,B01001_018E,B01001_038E,B01001_039E,B01001_040E,B01001_041E,B01001_042E,B25038_003E,B25038_004E,B25038_005E,B25038_006E,B25038_007E,B25082_001E,B25082_002E';

export async function geocodeZip(zip: string): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    where: `ZCTA5='${zip}'`,
    outSR: '4326',
    outFields: 'ZCTA5',
    returnCentroid: 'true',
    returnGeometry: 'true',
    f: 'json',
  });
  const r = await fetch(`${TIGER_BASE}/query?${params}`);
  if (!r.ok) return null;
  const data = await r.json();
  const feat = data.features?.[0];
  if (!feat) return null;
  // Prefer explicit centroid; fall back to averaging the outer polygon ring
  if (feat.centroid) return { lat: feat.centroid.y, lng: feat.centroid.x };
  const ring: [number, number][] = feat.geometry?.rings?.[0];
  if (!ring?.length) return null;
  const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return { lat, lng };
}

export async function getZctasNearPoint(lat: number, lng: number, radiusMiles: number): Promise<string[]> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(radiusMiles),
    units: 'esriSRUnit_StatuteMile',
    outFields: 'ZCTA5',
    returnGeometry: 'false',
    resultRecordCount: '500',
    f: 'json',
  });
  const r = await fetch(`${TIGER_BASE}/query?${params}`);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.features ?? []).map((f: { attributes: { ZCTA5: string } }) => f.attributes.ZCTA5);
}

// Census/demographic-only score per zip (owner-occupancy, income, home value, age mix, etc.) --
// same formula used elsewhere in the ZIP tool, deliberately independent of any client's own
// lead/show/close history so it works for a brand-new territory with zero performance data.
export async function fetchZipScores(zips: string[]): Promise<Record<string, { score: number; grade: "A" | "B" | "C" | "D" }>> {
  if (!CENSUS_KEY || !zips.length) return {};
  const CHUNK = 50;
  const scores: Record<string, { score: number; grade: "A" | "B" | "C" | "D" }> = {};

  for (let i = 0; i < zips.length; i += CHUNK) {
    const chunk = zips.slice(i, i + CHUNK);
    const url = `https://api.census.gov/data/2022/acs/acs5?get=${ACS_VARS}&for=zip%20code%20tabulation%20area:${chunk.join(',')}&key=${CENSUS_KEY}`;
    let rows: string[][];
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      rows = await r.json();
    } catch { continue; }

    const headers = rows[0];
    const col = (n: string) => headers.indexOf(n);

    for (let ri = 1; ri < rows.length; ri++) {
      const row = rows[ri];
      const zip = row[headers.indexOf('zip code tabulation area')];
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

      const long_term_units = (parseInt(row[col('B25038_005E')]) || 0)
        + (parseInt(row[col('B25038_006E')]) || 0)
        + (parseInt(row[col('B25038_007E')]) || 0);
      const long_term_pct = owner_units > 0 ? long_term_units / owner_units : 0;

      const agg_total     = parseInt(row[col('B25082_001E')]) || 0;
      const agg_mortgaged = parseInt(row[col('B25082_002E')]) || 0;
      const mortgage_pct  = agg_total > 0 && agg_mortgaged >= 0 ? Math.min(agg_mortgaged / agg_total, 1) : 0;

      const metrics: ZipMetrics = {
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

      if (pop < 500) continue; // skip near-empty ZCTAs, same threshold used elsewhere in the ZIP tool

      const { score, tier } = scoreZip(metrics);
      scores[zip] = { score, grade: tier };
    }
  }
  return scores;
}
