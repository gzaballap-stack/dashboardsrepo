import { NextResponse } from 'next/server';
import { hubAuth, isScope, pushAdNames, canRenameInMeta, type Entry } from '@/lib/creative-hub-entries';

/**
 * Rename ads in Meta to "<code> <name>" — every coded creative in a scope, or
 * one entry. Needs META_MANAGEMENT_TOKEN (ads_management); without it the
 * response says so and nothing is touched.
 *
 * POST { scope, entry_id?, current_names: { [ad_id]: name } }
 */
export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  if (!canRenameInMeta()) {
    return NextResponse.json({ error: 'Renaming in Facebook needs a token that can edit ads (META_MANAGEMENT_TOKEN). Copy the name and paste it into Ads Manager instead.' }, { status: 503 });
  }
  const body = await req.json() as { scope?: unknown; entry_id?: string; current_names?: Record<string, string> };
  if (!isScope(body.scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });

  let q = service.from('creative_hub_entries').select('*').eq('scope', body.scope).not('code', 'is', null);
  if (body.entry_id) q = q.eq('id', body.entry_id);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const results = await pushAdNames(service, (data ?? []) as Entry[], new Map(Object.entries(body.current_names ?? {})));
    return NextResponse.json({ results, renamed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
