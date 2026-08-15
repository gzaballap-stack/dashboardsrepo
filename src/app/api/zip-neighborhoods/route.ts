import { NextResponse } from 'next/server';
import { estimateDealVolume, type NeighborhoodData } from '@/lib/zip-score';

export type { NeighborhoodData };

const CENSUS_KEY = process.env.CENSUS_API_KEY ?? '';
const TIGER_TRACTS = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0';

type TractInfo = { state: string; county: string; tract: string; basename: string };

async function fetchTractsNearPoint(lat: number, lng: number): Promise<TractInfo[]> {
  const params = new URLSearchParams({
    geometryType: 'esriGeometryPoint',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: '8',
    units: 'esriSRUnit_StatuteMile',
    outFields: 'STATE,COUNTY,TRACT,BASENAME',
    returnGeometry: 'false',
    resultRecordCount: '60',
    f: 'json',
  });
  const r = await fetch(`${TIGER_TRACTS}/query?${params}`);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.features ?? []).map((f: { attributes: Record<string, unknown> }) => ({
    state:    String(f.attributes.STATE    ?? '').padStart(2, '0'),
    county:   String(f.attributes.COUNTY   ?? '').padStart(3, '0'),
    tract:    String(f.attributes.TRACT    ?? '').padStart(6, '0'),
    basename: String(f.attributes.BASENAME ?? f.attributes.TRACT ?? ''),
  }));
}

async function fetchTractACS(tracts: TractInfo[]): Promise<NeighborhoodData[]> {
  const vars = 'B19013_001E,B25077_001E,B25003_001E,B25003_002E,B25035_001E';
  const tractLookup = new Map<string, TractInfo>();
  for (const t of tracts) tractLookup.set(t.tract, t);

  const byCounty = new Map<string, { state: string; county: string }>();
  for (const t of tracts) byCounty.set(`${t.state}|${t.county}`, { state: t.state, county: t.county });

  const results: NeighborhoodData[] = [];

  for (const { state, county } of byCounty.values()) {
    const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=tract:*&in=state:${state}%20county:${county}&key=${CENSUS_KEY}`;
    let r: Response;
    try { r = await fetch(url); } catch { continue; }
    if (!r.ok) continue;
    let rows: string[][];
    try { rows = await r.json(); } catch { continue; }

    const headers = rows[0];
    const col = (name: string) => headers.indexOf(name);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const tractId = row[col('tract')];
      const match = tractLookup.get(tractId);
      if (!match) continue;

      const total_units = parseInt(row[col('B25003_001E')]) || 0;
      const owner_units = parseInt(row[col('B25003_002E')]) || 0;
      const income      = parseInt(row[col('B19013_001E')]) || 0;
      const med_year    = parseInt(row[col('B25035_001E')]) || 0;
      const home_value  = parseInt(row[col('B25077_001E')]) || 0;

      results.push({
        name:           `Tract ${match.basename || tractId}`,
        deal_volume:    estimateDealVolume(owner_units, income > 0 ? income : 0, med_year),
        median_income:  income > 0 ? income : 0,
        home_value:     home_value > 0 ? home_value : 0,
        owner_pct:      total_units > 0 ? (owner_units / total_units) * 100 : 0,
      });
    }
  }

  return results
    .filter(n => n.deal_volume > 0 || n.median_income > 0)
    .sort((a, b) => b.deal_volume - a.deal_volume);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zcta = searchParams.get('zcta')?.trim();
  const lat  = parseFloat(searchParams.get('lat') ?? '');
  const lng  = parseFloat(searchParams.get('lng') ?? '');

  if (!zcta || isNaN(lat) || isNaN(lng))
    return NextResponse.json({ error: 'zcta, lat, lng are required' }, { status: 400 });
  if (!CENSUS_KEY)
    return NextResponse.json({ error: 'CENSUS_API_KEY not configured' }, { status: 500 });

  const tracts = await fetchTractsNearPoint(lat, lng);
  if (!tracts.length) return NextResponse.json({ zcta, neighborhoods: [] });

  const neighborhoods = await fetchTractACS(tracts);
  return NextResponse.json({ zcta, neighborhoods });
}
