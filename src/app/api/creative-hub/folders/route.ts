import { NextResponse } from 'next/server';
import { CATEGORY_CODES, folderSlug } from '@/lib/creative-key';
import { codeFor, type Folder } from '@/lib/creative-hub-entries';
import { hubAuth, isScope, loadFolders, type Entry } from '@/lib/creative-hub-entries';

/**
 * Folders inside a category (AI image › Slop).
 *
 * POST   { scope, category, name, move_root? }  → create. With move_root, every
 *        creative sitting at the category's root moves into the new folder (in
 *        its existing order) and is renumbered — a category either has folders
 *        or it doesn't.
 * PATCH  { id, name?, code? }                   → rename, and/or change the folder's code
 *        part (SLOP → OCT26); every creative inside is recoded, numbers kept
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
    const { data: root } = await service.from('creative_hub_entries').select('id, seq, name')
      .eq('scope', body.scope).eq('category', body.category).is('folder_id', null).order('seq');
    let seq = 0;
    for (const e of (root ?? []) as Pick<Entry, 'id' | 'seq' | 'name'>[]) {
      seq += 1;
      await service.from('creative_hub_entries')
        .update({ folder_id: folder.id, seq, code: await codeFor(service, body.scope, body.category, slug, e.name, seq, e.id), updated_at: new Date().toISOString() })
        .eq('id', e.id);
      moved += 1;
    }
  }
  return NextResponse.json({ folder, moved, folders: await loadFolders(service, body.scope) });
}

export async function PATCH(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const body = await req.json() as { id?: string; name?: string; code?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { data: current } = await service.from('creative_hub_folders').select('*').eq('id', body.id).maybeSingle();
  if (!current) return NextResponse.json({ error: 'That folder no longer exists.' }, { status: 404 });
  const folder = current as Folder;

  const change: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.replace(/\s+/g, ' ').trim();
    if (!name) return NextResponse.json({ error: 'The name can\'t be empty.' }, { status: 400 });
    change.name = name;
  }
  let slug: string | null = null;
  if (typeof body.code === 'string') {
    slug = body.code.toUpperCase().replace(/[^A-Z0-9-]+/g, '').replace(/^-+|-+$/g, '').slice(0, 12);
    if (!slug || !/^[A-Z0-9]/.test(slug)) return NextResponse.json({ error: 'Codes use letters, numbers and dashes, e.g. OCT26.' }, { status: 400 });
    if (slug !== folder.slug) change.slug = slug; else slug = null;
  }
  if (!Object.keys(change).length) return NextResponse.json({ folder, recoded: 0 });

  const { data, error } = await service.from('creative_hub_folders').update(change).eq('id', folder.id).select().single();
  if (error) {
    const clash = error.code === '23505';
    return NextResponse.json({ error: clash ? `Another ${folder.category} folder already uses the code ${slug}.` : error.message }, { status: clash ? 409 : 500 });
  }

  // New code part → every creative inside gets it; their numbers stay. Ads stay
  // attached (they're linked by id), but their names in Meta now differ, which
  // the hub flags for renaming.
  let recoded = 0;
  if (slug) {
    const { data: inside } = await service.from('creative_hub_entries').select('id, seq, name').eq('folder_id', folder.id);
    for (const e of inside ?? []) {
      if (!e.seq) continue;
      await service.from('creative_hub_entries')
        .update({ code: await codeFor(service, folder.scope, folder.category, slug, e.name as string, e.seq as number, e.id as string), updated_at: new Date().toISOString() })
        .eq('id', e.id);
      recoded += 1;
    }
  }
  return NextResponse.json({ folder: data, recoded });
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
