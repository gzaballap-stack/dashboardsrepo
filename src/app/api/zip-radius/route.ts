import { NextResponse } from 'next/server';
import { scoreZip } from '@/lib/zip-score';

const TIGER_BASE  = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';
const CENSUS_KEY  = process.env.CENSUS_API_KEY ?? '';
const ACS_VARS    = 'B25003_001E,B25003_002E,B19013_001E,B25035_001E,B01003_001E,B25077_001E,B01001_001E,B01001_014E,B01001_015E,B01001_016E,B01001_017E,B01001_018E,B01001_038E,B01001_039E,B01001_040E,B01001_041E,B01001_042E,B25038_003E,B25038_004E,B25038_005E,B25038_006E,B25038_007E,B25082_001E,B25082_002E';

const cache = new Map<string, { ts: number; data: object }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function getZctasNearPoint(lat: number, lng: number, radiusMiles: number): Promise<string[]> {
  const params = new URLSearchParams({
    geometry:      JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType:  'esriGeometryPoint',
    inSR:          '4326',
    distance:      String(radiusMiles),
    units:         'esriSRUnit_StatuteMile',
    outFields:     'ZCTA5',
    returnGeometry:'false',
    resultRecordCount: '500',
    f: 'json',
  });
  const r = await fetch(`${TIGER_BASE}/query?${params}`);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.features ?? []).map((f: { attributes: { ZCTA5: string } }) => f.attributes.ZCTA5);
}

async function fetchGeoJSON(zips: string[]): Promise<Map<string, object>> {
  const CHUNK = 40;
  const geo = new Map<string, object>();
  for (let i = 0; i < zips.length; i += CHUNK) {
    const chunk = zips.slice(i, i + CHUNK);
    const where = `ZCTA5 IN (${chunk.map(z => `'${z}'`).join(',')})`;
    const params = new URLSearchParams({ where, outSR: '4326', outFields: 'ZCTA5', f: 'geojson' });
    const r = await fetch(`${TIGER_BASE}/query?${params}`);
    if (!r.ok) continue;
    const data = await r.json();
    for (const feat of data.features ?? []) geo.set(feat.properties?.ZCTA5, feat.geometry);
  }
  return geo;
}

async function fetchACSScores(zips: string[]): Promise<Record<string, { score: number; grade: "A"|"B"|"C"|"D" }>> {
  if (!CENSUS_KEY || !zips.length) return {};
  const CHUNK = 50;
  const scores: Record<string, { score: number; grade: "A"|"B"|"C"|"D" }> = {};

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
      const zip         = row[headers.indexOf('zip code tabulation area')];
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

      const metrics = {
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

      const { score, tier } = scoreZip(metrics);
      scores[zip] = { score, grade: tier };
    }
  }
  return scores;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat    = parseFloat(searchParams.get('lat') ?? '');
  const lng    = parseFloat(searchParams.get('lng') ?? '');
  const radius = Math.min(parseInt(searchParams.get('radius') ?? '35'), 200);

  if (isNaN(lat) || isNaN(lng))
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });

  const key = `${lat.toFixed(3)}|${lng.toFixed(3)}|${radius}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return NextResponse.json(hit.data);

  const zips = await getZctasNearPoint(lat, lng, radius);

  const [geoMap, scores] = await Promise.all([
    fetchGeoJSON(zips),
    fetchACSScores(zips),
  ]);

  const features = zips
    .filter(z => geoMap.has(z))
    .map(z => ({ type: 'Feature' as const, properties: { zip: z }, geometry: geoMap.get(z) }));

  const result = { zips: zips.sort(), features, scores };
  cache.set(key, { ts: Date.now(), data: result });
  return NextResponse.json(result);
}
