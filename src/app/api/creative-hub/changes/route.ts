import { NextResponse } from 'next/server';
import { hubAuth, isScope } from '@/lib/creative-hub-entries';

/**
 * The change log: what was done to the ads and when — "paused AI Slop 4",
 * "budget up to $150/day", "new hook on TH/002". Each note has a date and can
 * be tied to one creative or one campaign; it shows on the timeline.
 *
 * GET    ?scope=b2b|b2c
 * POST   { scope, happened_on, note, entry_id?, campaign_id? }   (id? → update)
 * DELETE ?id=
 */

export async function GET(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const scope = new URL(req.url).searchParams.get('scope');
  if (!isScope(scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const { data, error } = await service.from('creative_hub_changes').select('*').eq('scope', scope)
    .order('happened_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ changes: data ?? [] });
}

export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const body = await req.json() as Record<string, unknown>;
  if (!isScope(body.scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const day = typeof body.happened_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.happened_on) ? body.happened_on : null;
  if (!note) return NextResponse.json({ error: 'Write what changed.' }, { status: 400 });
  if (!day) return NextResponse.json({ error: 'A date is required.' }, { status: 400 });
  const row = {
    scope: body.scope, happened_on: day, note,
    entry_id: typeof body.entry_id === 'string' && body.entry_id ? body.entry_id : null,
    campaign_id: typeof body.campaign_id === 'string' && body.campaign_id ? body.campaign_id : null,
  };
  const id = typeof body.id === 'string' && body.id ? body.id : null;
  const q = id ? service.from('creative_hub_changes').update(row).eq('id', id) : service.from('creative_hub_changes').insert(row);
  const { data, error } = await q.select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ change: data });
}

export async function DELETE(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await service.from('creative_hub_changes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
