import { NextResponse } from 'next/server';
import { hubAuth, isScope } from '@/lib/creative-hub-entries';

/**
 * Copy sets — the texts an ad rotates through (Advantage+ creative takes up to
 * five primary texts, five headlines and five descriptions), kept per campaign.
 *
 * GET    ?scope=b2b|b2c                → { sets }
 * POST   { id?, scope, name, … }       → create or update
 * DELETE ?id=
 */

const LIMIT = 5;
const LIST_FIELDS = ['bodies', 'headlines', 'descriptions'] as const;
const TEXT_FIELDS = ['campaign_label', 'notes', 'cta', 'link'] as const;

const cleanList = (v: unknown) =>
  (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, LIMIT);

export async function GET(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const scope = new URL(req.url).searchParams.get('scope');
  if (!isScope(scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const { data, error } = await service.from('creative_hub_copy_sets').select('*').eq('scope', scope).order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sets: data ?? [], limit: LIMIT });
}

export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const body = await req.json() as Record<string, unknown>;
  if (!isScope(body.scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

  const row: Record<string, unknown> = { scope: body.scope, name, updated_at: new Date().toISOString() };
  for (const f of TEXT_FIELDS) if (f in body) row[f] = typeof body[f] === 'string' && (body[f] as string).trim() ? (body[f] as string).trim() : null;
  for (const f of LIST_FIELDS) if (f in body) row[f] = cleanList(body[f]);

  const id = typeof body.id === 'string' && body.id ? body.id : null;
  const q = id ? service.from('creative_hub_copy_sets').update(row).eq('id', id) : service.from('creative_hub_copy_sets').insert(row);
  const { data, error } = await q.select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ set: data });
}

export async function DELETE(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await service.from('creative_hub_copy_sets').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
