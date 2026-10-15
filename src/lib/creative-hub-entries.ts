// Creative & Copy Hub — entries, folders and codes.
//
// A creative's code is where it is filed: category, folder inside the category
// (optional) and a running number — AI/SLOP/001, TH/004. Numbers run per
// folder and are handed out in the order creatives are filed. Moving a creative
// to another folder gives it the next number there; the ads stay attached
// because they are bound by id in creative_hub_links, not by name.

import { NextResponse } from 'next/server';
import { createServiceClient } from './supabase';
import { getAuthContext, isAuthError, validateWebhookSecret } from './api-auth';
import { CATEGORY_CODES, buildCode, codeTail, creativeKey } from './creative-key';

export type Service = ReturnType<typeof createServiceClient>;
export type Scope = 'b2b' | 'b2c';

export const ENTRY_FIELDS = [
  'tags', 'kind', 'campaign_label', 'launch_date', 'headline', 'primary_text',
  'prompt', 'script', 'background_notes', 'notes', 'media_url',
] as const;

export type Entry = {
  id: string; scope: Scope; pool_key: string; name: string; updated_at: string;
  code: string | null; category: string | null; folder_id: string | null; seq: number | null;
  copy_set_id: string | null; code_tail: string | null;
} & Record<(typeof ENTRY_FIELDS)[number], string | null>;

export type Folder = { id: string; scope: Scope; category: string; name: string; slug: string; sort: number };

/** Session user, or the admin secret (so scripts can drive the hub). */
export async function hubAuth(req: Request): Promise<Service | NextResponse> {
  if (validateWebhookSecret(req)) return createServiceClient();
  const ctx = await getAuthContext();
  return isAuthError(ctx) ? ctx : ctx.service;
}

export const isScope = (s: unknown): s is Scope => s === 'b2b' || s === 'b2c';

/** The exact string the ad should be called in Meta. */
export const facebookName = (e: { code: string | null; name: string }) => (e.code ? `${e.code} ${e.name}` : e.name);

export async function loadFolders(service: Service, scope: Scope): Promise<Folder[]> {
  const { data } = await service.from('creative_hub_folders').select('*').eq('scope', scope).order('sort').order('created_at');
  return (data ?? []) as Folder[];
}

/**
 * `code` if nobody else has it, else the same with a variant letter — H6B3b,
 * H6B3c… (two takes of the same hook and body). `self` is the entry being coded.
 */
export async function uniqueCode(service: Service, scope: Scope, code: string, self: string | null): Promise<string> {
  for (const suffix of ['', ...'bcdefghijklmnopqrstuvwxyz']) {
    const candidate = code + suffix;
    let q = service.from('creative_hub_entries').select('id').eq('scope', scope).eq('code', candidate);
    if (self) q = q.neq('id', self);
    const { data } = await q.limit(1);
    if (!data?.length) return candidate;
  }
  return code;
}

/**
 * The code an entry gets at a position: category, folder and its number / H#B#
 * — or the last part typed by hand (`manual`), which is used as is; a clash
 * with another creative then fails on save rather than being lettered away.
 */
export async function codeFor(service: Service, scope: Scope, category: string, folderSlug: string | null, name: string, seq: number, self: string | null, manual: string | null = null) {
  if (manual) return buildCode(category, folderSlug, manual);
  return uniqueCode(service, scope, buildCode(category, folderSlug, codeTail(category, name, seq)), self);
}

/**
 * The next free number in a folder (or at a category's root), and the code it
 * makes. Numbers are never reused: a deleted creative leaves a gap.
 */
export async function nextCode(service: Service, scope: Scope, category: string, folder: Folder | null, name: string, self: string | null): Promise<{ seq: number; code: string }> {
  let q = service.from('creative_hub_entries').select('seq').eq('scope', scope).eq('category', category);
  q = folder ? q.eq('folder_id', folder.id) : q.is('folder_id', null);
  const { data } = await q.order('seq', { ascending: false }).limit(1);
  const seq = ((data?.[0]?.seq as number | null) ?? 0) + 1;
  return { seq, code: await codeFor(service, scope, category, folder?.slug ?? null, name, seq, self) };
}

/**
 * Resolve the filing a request asks for. Returns the columns to write, or an
 * error message. `current` is the entry as stored, so an unchanged filing keeps
 * its number; `name` is the title being saved (talking-head codes follow it).
 */
export async function resolveFiling(
  service: Service, scope: Scope, folders: Folder[],
  wanted: { category: string | null; folder_id: string | null },
  current: { id?: string; category: string | null; folder_id: string | null; seq: number | null; code: string | null; code_tail?: string | null } | null,
  name: string,
  manual?: string | null,   // a hand-typed last part; undefined = keep whatever the entry has
): Promise<{ category: string | null; folder_id: string | null; seq: number | null; code: string | null } | { error: string }> {
  const category = wanted.category || null;
  if (category && !CATEGORY_CODES.includes(category)) return { error: `Unknown category "${category}".` };
  if (!category) return { category: null, folder_id: null, seq: null, code: null };

  const folder = wanted.folder_id ? folders.find(f => f.id === wanted.folder_id) ?? null : null;
  if (wanted.folder_id && !folder) return { error: 'That folder no longer exists.' };
  if (folder && folder.category !== category) return { error: `Folder "${folder.name}" belongs to another category.` };

  const self = current?.id ?? null;
  const tail = manual !== undefined ? manual : current?.code_tail ?? null;
  if (current && current.category === category && (current.folder_id ?? null) === (folder?.id ?? null) && current.seq && current.code) {
    // Same place: keep the number. The code is rebuilt in case the title changed
    // the hook/body it reads as; otherwise it comes out unchanged.
    return { category, folder_id: folder?.id ?? null, seq: current.seq, code: await codeFor(service, scope, category, folder?.slug ?? null, name, current.seq, self, tail) };
  }
  const next = await nextCode(service, scope, category, folder, name, self);
  if (tail) next.code = await codeFor(service, scope, category, folder?.slug ?? null, name, next.seq, self, tail);
  return { category, folder_id: folder?.id ?? null, ...next };
}

/** Create the entry for a creative that so far exists only as an ad name. */
export async function ensureEntry(service: Service, scope: Scope, name: string): Promise<Entry | { error: string }> {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return { error: 'A name is required' };
  const { data, error } = await service
    .from('creative_hub_entries')
    .upsert({ scope, name: clean, pool_key: creativeKey(clean, scope === 'b2b') }, { onConflict: 'scope,pool_key', ignoreDuplicates: false })
    .select().single();
  if (error) return { error: error.message };
  return data as Entry;
}

// ── Renaming ads in Meta ───────────────────────────────────────────────────
// Needs a token with ads_management (META_MANAGEMENT_TOKEN). The read token
// the rest of the app uses cannot write.

export type RenameResult = { ad_id: string; from: string; to: string; ok: boolean; error?: string };

export function canRenameInMeta(): boolean {
  return !!process.env.META_MANAGEMENT_TOKEN;
}

/**
 * Rename every ad linked to these entries to "<code> <name>". Ads already
 * named correctly are skipped. Returns one line per ad touched.
 */
export async function pushAdNames(service: Service, entries: Entry[], currentNames: Map<string, string>): Promise<RenameResult[]> {
  const token = process.env.META_MANAGEMENT_TOKEN;
  if (!token || !entries.length) return [];
  const { data: links } = await service.from('creative_hub_links').select('ad_id, entry_id').in('entry_id', entries.map(e => e.id));
  const byId = new Map(entries.map(e => [e.id, e]));
  const jobs = (links ?? [])
    .map(l => ({ ad_id: l.ad_id as string, to: facebookName(byId.get(l.entry_id as string)!), from: currentNames.get(l.ad_id as string) ?? '' }))
    .filter(j => j.from !== j.to);
  if (!jobs.length) return [];

  const out: RenameResult[] = [];
  for (let i = 0; i < jobs.length; i += 50) {
    const slice = jobs.slice(i, i + 50);
    const res = await fetch('https://graph.facebook.com/v19.0/', {
      method: 'POST',
      body: new URLSearchParams({
        access_token: token,
        batch: JSON.stringify(slice.map(j => ({ method: 'POST', relative_url: j.ad_id, body: `name=${encodeURIComponent(j.to)}` }))),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json() as unknown;
    slice.forEach((j, k) => {
      const slot = Array.isArray(json) ? json[k] as { code?: number; body?: string } : null;
      let error: string | undefined;
      if (!slot || slot.code !== 200) {
        try { error = (JSON.parse(slot?.body ?? '{}') as { error?: { message?: string } }).error?.message ?? `HTTP ${slot?.code ?? '?'}`; }
        catch { error = `HTTP ${slot?.code ?? '?'}`; }
      }
      out.push({ ...j, ok: !error, error });
    });
  }
  return out;
}
