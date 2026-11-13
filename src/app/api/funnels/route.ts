import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { ensureDefaultFunnel, funnelStats, tablesMissing, VERSION_COLS, type FunnelRow, type VersionRow } from '@/lib/funnels';
import { normalizeContent } from '@/lib/funnel-content';

// Funnels (Tomsi Media > Funnels): the versions of each website funnel, which
// are live, and what each one produced. Gated on b2b_tracking (feature-access).
//
//   GET  ?start_date=&end_date=      every funnel, its versions and their stats
//   POST { action, ... }             new_version · save · publish · pause · weight · archive · delete

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const { searchParams } = new URL(req.url);
  const start = DATE.test(searchParams.get('start_date') ?? '') ? searchParams.get('start_date') : null;
  const end = DATE.test(searchParams.get('end_date') ?? '') ? searchParams.get('end_date') : null;

  const probe = await ctx.service.from('funnels').select('id').limit(1);
  if (probe.error) {
    if (tablesMissing(probe.error.message)) return NextResponse.json({ ready: false, funnels: [] });
    return bad(probe.error.message, 500);
  }
  await ensureDefaultFunnel(ctx.service);

  const { data: funnels, error } = await ctx.service.from('funnels').select('id, slug, name, client_id, site_url').order('created_at');
  if (error) return bad(error.message, 500);
  const out = [];
  for (const f of (funnels ?? []) as FunnelRow[]) {
    const { data: versions, error: vErr } = await ctx.service.from('funnel_versions').select(VERSION_COLS).eq('funnel_id', f.id).order('number', { ascending: false });
    if (vErr) return bad(vErr.message, 500);
    let stats = {}, legacy = null;
    try { ({ versions: stats, legacy } = await funnelStats(ctx.service, f, start, end)); } catch { /* stats are best-effort; the versions still show */ }
    out.push({
      ...f,
      versions: ((versions ?? []) as VersionRow[]).map(v => ({ ...v, content: normalizeContent(v.content) })),
      stats,
      legacy,
    });
  }
  return NextResponse.json({ ready: true, funnels: out });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad('Bad request'); }
  const action = String(body.action ?? '');
  const s = ctx.service;
  const now = new Date().toISOString();

  // A new draft, copied from an existing version (or from the original funnel).
  if (action === 'new_version') {
    const funnel_id = String(body.funnel_id ?? '');
    const { data: all, error } = await s.from('funnel_versions').select('id, number, name, content').eq('funnel_id', funnel_id).order('number', { ascending: false });
    if (error) return bad(error.message, 500);
    if (!all?.length) return bad('Funnel not found', 404);
    const from = all.find(v => v.id === body.from_version_id) ?? all[0];
    const { data, error: insErr } = await s.from('funnel_versions').insert({
      funnel_id, number: all[0].number + 1, name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : `Copy of version ${from.number}`,
      content: normalizeContent(from.content), status: 'draft', weight: 100,
    }).select(VERSION_COLS).single();
    if (insErr) return bad(insErr.message, 500);
    return NextResponse.json({ version: data });
  }

  const id = String(body.id ?? '');
  const { data: version, error: getErr } = await s.from('funnel_versions').select(VERSION_COLS).eq('id', id).maybeSingle();
  if (getErr) return bad(getErr.message, 500);
  if (!version) return bad('Version not found', 404);
  const v = version as VersionRow;
  const update = async (patch: Record<string, unknown>) => {
    const { error } = await s.from('funnel_versions').update({ ...patch, updated_at: now }).eq('id', id);
    return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
  };

  if (action === 'save') {
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 80);
    if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 4000);
    if (body.content !== undefined) {
      // Once a version has been live its wording is frozen, so its numbers
      // always describe one page. Changes go into a new version.
      if (v.published_at) return bad('This version has been live, so it can no longer be changed. Make a copy and edit that.');
      patch.content = normalizeContent(body.content);
    }
    return update(patch);
  }

  if (action === 'publish') {
    if (v.status === 'archived') return bad('Restore this version first.');
    // replace = this becomes the only live version; split = it shares traffic with the ones already live.
    if (body.mode !== 'split') {
      const { error } = await s.from('funnel_versions').update({ status: 'paused', updated_at: now }).eq('funnel_id', v.funnel_id).eq('status', 'live').neq('id', id);
      if (error) return bad(error.message, 500);
    }
    const weight = Number.isFinite(Number(body.weight)) ? Math.max(1, Math.min(100, Math.round(Number(body.weight)))) : (body.mode === 'split' ? 50 : 100);
    return update({ status: 'live', weight, published_at: v.published_at ?? now });
  }

  if (action === 'pause' || action === 'archive') {
    if (v.status === 'live') {
      const { count } = await s.from('funnel_versions').select('id', { count: 'exact', head: true }).eq('funnel_id', v.funnel_id).eq('status', 'live').neq('id', id);
      if (!count) return bad('This is the only live version. Make another one live first.');
    }
    return update({ status: action === 'pause' ? 'paused' : 'archived' });
  }

  if (action === 'restore') {
    if (v.status !== 'archived') return bad('Only archived versions can be restored.');
    return update({ status: v.published_at ? 'paused' : 'draft' });
  }

  if (action === 'weight') {
    const weight = Math.round(Number(body.weight));
    if (!Number.isFinite(weight) || weight < 1 || weight > 100) return bad('Share must be between 1 and 100.');
    return update({ weight });
  }

  if (action === 'delete') {
    if (v.published_at) return bad('A version that has been live keeps its numbers and cannot be deleted. Archive it instead.');
    const { error } = await s.from('funnel_versions').delete().eq('id', id);
    return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
  }

  return bad('Unknown action');
}
