import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { normalizeContent } from '@/lib/funnel-content';
import { VERSION_COLS, type VersionRow } from '@/lib/funnels';

// Funnel drafts from a Claude session (scripts/funnel-draft.mjs).
//
// The user asks for a change in chat; Claude writes it here as a DRAFT version.
// The user then opens it in Tomsi Media > Funnels, looks at it, and makes it
// live themselves. This route can never change what visitors see: it only
// creates drafts and edits drafts that have never been live.
//
//   GET  ?slug=<funnel>                     every version with its wording
//   POST { slug, from?, name?, notes?, content }            a new draft (copied from version `from`, else the live one)
//   POST { slug, number, name?, notes?, content? }          change an existing draft
//
// Admin secret only (it sits under /api/webhooks, which skips the session check).

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function funnelOf(service: ReturnType<typeof createServiceClient>, slug: string) {
  const { data: funnel } = await service.from('funnels').select('id, slug, site_url').eq('slug', slug).maybeSingle();
  if (!funnel) return null;
  const { data: versions } = await service.from('funnel_versions').select(VERSION_COLS).eq('funnel_id', funnel.id).order('number', { ascending: false });
  return { funnel, versions: (versions ?? []) as VersionRow[] };
}

export async function GET(req: Request) {
  if (!validateWebhookSecret(req)) return bad('Unauthorized', 401);
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  const found = await funnelOf(createServiceClient(), slug);
  if (!found) return bad('Funnel not found', 404);
  return NextResponse.json({
    funnel: found.funnel,
    versions: found.versions.map(v => ({ number: v.number, id: v.id, name: v.name, notes: v.notes, status: v.status, locked: !!v.published_at, content: normalizeContent(v.content) })),
  });
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) return bad('Unauthorized', 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad('Bad request'); }
  const service = createServiceClient();
  const found = await funnelOf(service, String(body.slug ?? ''));
  if (!found) return bad('Funnel not found', 404);
  const { funnel, versions } = found;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : undefined;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : undefined;
  const preview = (v: { id: string }) => `${funnel.site_url}?version=${v.id}&preview=tomsi`;

  if (body.number !== undefined) {
    const v = versions.find(x => x.number === Number(body.number));
    if (!v) return bad('Version not found', 404);
    if (v.published_at || v.status !== 'draft') return bad('That version has been live or is not a draft. Make a new draft instead.');
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) patch.name = name;
    if (notes !== undefined) patch.notes = notes;
    if (body.content !== undefined) patch.content = normalizeContent(body.content);
    const { error } = await service.from('funnel_versions').update(patch).eq('id', v.id);
    if (error) return bad(error.message, 500);
    return NextResponse.json({ ok: true, number: v.number, status: 'draft', preview: preview(v) });
  }

  if (!versions.length) return bad('The funnel has no versions yet');
  const from = versions.find(x => x.number === Number(body.from)) ?? versions.find(x => x.status === 'live') ?? versions[0];
  const { data, error } = await service.from('funnel_versions').insert({
    funnel_id: funnel.id, number: versions[0].number + 1, name: name || `Draft from version ${from.number}`, notes: notes ?? '',
    content: normalizeContent(body.content ?? from.content), status: 'draft', weight: 100,
  }).select('id, number').single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true, number: data.number, status: 'draft', preview: preview(data) });
}
