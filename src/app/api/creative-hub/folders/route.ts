import { NextResponse } from 'next/server';
import { CATEGORY_CODES, buildCode, folderSlug } from '@/lib/creative-key';
import { hubAuth, isScope, loadFolders, type Entry } from '@/lib/creative-hub-entries';

/**
 * Folders inside a category (AI image › Slop).
 *
 * POST   { scope, category, name, move_root? }  → create. With move_root, every
 *        creative sitting at the category's root moves into the new folder (in
 *        its existing order) and is renumbered — a category either has folders
 *        or it doesn't.
 * PATCH  { id, name }                           → rename (the code part stays)
 * DELETE ?id=                                   → only when empty
 */

export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;

  const body = await req.json() as { scope?: unknown; category?: string; name?: string; move_root?: boolean };
  const name = (body.name ?? '').replace(/\s+/g, ' ').trim();
  if (!isScope(body.scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  if (!body.category || !CATEGORY_CODES.includes(body.category)) return NextResponse.json({ error: 'Unknown category.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'A folder name is required.' }, { status: 400 });
  const slug = folderSlug(name);
  if (!slug) return NextResponse.json({ error: 'The folder name needs at least one letter or number.' }, { status: 400 });

  const { count } = await service.from('creative_hub_folders').select('id', { count: 'exact', head: true }).eq('scope', body.scope).eq('category', body.category);
  const { data: folder, error } = await service
    .from('creative_hub_folders')
    .insert({ scope: body.scope, category: body.category, name, slug, sort: count ?? 0 })
    .select().single();
  if (error) {
    return NextResponse.json({ error: error.code === '23505' ? `A folder coded ${slug} already exists here.` : error.message }, { status: error.code === '23505' ? 409 : 500 });
  }

  let moved = 0;
  if (body.move_root) {
    const { data: root } = await service.from('creative_hub_entries').select('id, seq')
      .eq('scope', body.scope).eq('category', body.category).is('folder_id', null).order('seq');
    let seq = 0;
    for (const e of (root ?? []) as Pick<Entry, 'id' | 'seq'>[]) {
      seq += 1;
      await service.from('creative_hub_entries')
        .update({ folder_id: folder.id, seq, code: buildCode(body.category, slug, seq), updated_at: new Date().toISOString() })
        .eq('id', e.id);
      moved += 1;
    }
  }
  return NextResponse.json({ folder, moved, folders: await loadFolders(service, body.scope) });
}

export async function PATCH(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const body = await req.json() as { id?: string; name?: string };
  const name = (body.name ?? '').replace(/\s+/g, ' ').trim();
  if (!body.id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 });
  const { data, error } = await service.from('creative_hub_folders').update({ name }).eq('id', body.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ folder: data });
}

export async function DELETE(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { count } = await service.from('creative_hub_entries').select('id', { count: 'exact', head: true }).eq('folder_id', id);
  if (count) return NextResponse.json({ error: `Move its ${count} creative${count === 1 ? '' : 's'} out first.` }, { status: 409 });
  const { error } = await service.from('creative_hub_folders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
