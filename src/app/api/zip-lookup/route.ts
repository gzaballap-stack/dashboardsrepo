import { NextResponse } from 'next/server';
import { scoreZip, type ZipMetrics } from '@/lib/zip-score';

const CENSUS_KEY = process.env.CENSUS_API_KEY ?? '';
const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';

const cache = new Map<string, { ts: number; data: object }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function geocodeZip(zip: string): Promise<{ lat: number; lng: number; display: string } | null> {
  const params = new URLSearchParams({
    where: `ZCTA5='${zip}'`,
    outSR: '4326',
    outFields: 'ZCTA5',
    returnCentroid: 'true',
    f: 'json',
  });
  const r = await fetch(`${TIGER_BASE}/query?${params}`);
  const data = await r.json();
  const feat = data.features?.[0];
  if (!feat?.centroid) return null;
  return { lat: feat.centroid.y, lng: feat.centroid.x, display: `ZIP ${zip}` };
}

async function getZctasNearPoint(lat: number, lng: number, radiusMiles = 40): Promise<string[]> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(radiusMiles),
    units: 'esriSRUnit_StatuteMile',
    outFields: 'ZCTA5',
    returnGeometry: 'false',
    f: 'json',
  });
  const r = await fetch(`${TIGER_BASE}/query?${params}`);
  const data = await r.json();
  return (data.features ?? []).map((f: { attributes: { ZCTA5: string } }) => f.attributes.ZCTA5);
}

async function fetchACS(zips: string[]): Promise<Map<string, ZipMetrics>> {
  const vars = 'B25003_001E,B25003_002E,B19013_001E,B25035_001E,B01003_001E,B25077_001E';
  const CHUNK = 50;
  const results = new Map<string, ZipMetrics>();

  for (let i = 0; i < zips.length; i += CHUNK) {
    const chunk = zips.slice(i, i + CHUNK);
    const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=zip%20code%20tabulation%20area:${chunk.join(',')}&key=${CENSUS_KEY}`;
    const r = await fetch(url);
    if (!r.ok) continue;
    const rows: string[][] = await r.json();
    const headers = rows[0];
    const col = (name: string) => headers.indexOf(name);

    for (let ri = 1; ri < rows.length; ri++) {
      const row = rows[ri];
      const zip = row[headers.indexOf('zip code tabulation area')];
      const total_units = parseInt(row[col('B25003_001E')]) || 0;
      const owner_units = parseInt(row[col('B25003_002E')]) || 0;
      const income      = parseInt(row[col('B19013_001E')]) || 0;
      const med_year    = parseInt(row[col('B25035_001E')]) || 0;
      const pop         = parseInt(row[col('B01003_001E')]) || 0;
      const home_value  = parseInt(row[col('B25077_001E')]) || 0;
      results.set(zip, {
        zip,
        owner_pct:        total_units > 0 ? (owner_units / total_units) * 100 : 0,
        owner_units,
        median_income:    income > 0 ? income : 0,
        median_year:      med_year > 0 ? med_year : 0,
        population:       pop,
        home_value:       home_value > 0 ? home_value : 0,
        prime_age_pct:    0,
        recent_mover_pct: 0,
        long_term_pct:    0,
        mortgage_pct:     0,
      });
    }
  }
  return results;
}

async function fetchGeoJSON(zips: string[]): Promise<Map<string, object>> {
  const CHUNK = 40;
  const geo = new Map<string, object>();
  for (let i = 0; i < zips.length; i += CHUNK) {
    const chunk = zips.slice(i, i + CHUNK);
    const whereClause = `ZCTA5 IN (${chunk.map(z => `'${z}'`).join(',')})`;
    const params = new URLSearchParams({ where: whereClause, outSR: '4326', outFields: 'ZCTA5', f: 'geojson' });
    const r = await fetch(`${TIGER_BASE}/query?${params}`);
    if (!r.ok) continue;
    const data = await r.json();
    for (const feat of data.features ?? []) {
      geo.set(feat.properties?.ZCTA5, feat.geometry);
    }
  }
  return geo;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const radiusMiles = Math.min(parseInt(searchParams.get('radius') ?? '35'), 75);

  if (!q) return NextResponse.json({ error: 'q is required' }, { status: 400 });
  if (!/^\d{5}$/.test(q)) return NextResponse.json({ error: 'Enter a 5-digit US zip code' }, { status: 400 });
  if (!CENSUS_KEY) return NextResponse.json({ error: 'CENSUS_API_KEY not configured' }, { status: 500 });

  const cacheKey = `${q}|${radiusMiles}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return NextResponse.json(cached.data);

  const geo = await geocodeZip(q);
  if (!geo) return NextResponse.json({ error: `Zip code "${q}" not found` }, { status: 404 });

  const zctas = await getZctasNearPoint(geo.lat, geo.lng, radiusMiles);
  if (!zctas.length) return NextResponse.json({ error: 'No zip codes found in area' }, { status: 404 });

  const [acsMap, geoMap] = await Promise.all([fetchACS(zctas), fetchGeoJSON(zctas)]);

  const zips = zctas
    .map(z => {
      const metrics = acsMap.get(z);
      if (!metrics || metrics.population < 500) return null;
      return { ...scoreZip(metrics), geometry: geoMap.get(z) ?? null };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score);

  const result = { city: geo.display, center: { lat: geo.lat, lng: geo.lng }, radius_miles: radiusMiles, zips };
  cache.set(cacheKey, { ts: Date.now(), data: result });
  return NextResponse.json(result);
}
