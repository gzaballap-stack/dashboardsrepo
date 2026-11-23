import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { build, builderOptions, lastBuild, planBuild, type BuildInput } from '@/lib/campaign-builder';

/**
 * Build Campaign (lib/campaign-builder.ts) — admins only: it creates things
 * in a client's ad account (always paused).
 *
 * GET  ?client_id=                       → { options, last }
 * POST { action: 'preview', …BuildInput } → { problems, names }
 * POST { action: 'build',   …BuildInput } → BuildResult
 */

export const maxDuration = 300;

async function admin() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const { data } = await ctx.service.from('profiles').select('is_admin').eq('id', ctx.userId).maybeSingle();
  if (data?.is_admin !== true) return NextResponse.json({ error: 'Only an admin can build campaigns' }, { status: 403 });
  return ctx;
}

function input(body: Record<string, unknown>): BuildInput {
  const ads = Array.isArray(body.ads) ? body.ads : [];
  return {
    client_id: String(body.client_id ?? ''),
    page_id: String(body.page_id ?? '').replace(/\D/g, ''),
    budget: Number(body.budget),
    thank_you_url: typeof body.thank_you_url === 'string' && /^https?:\/\//.test(body.thank_you_url) ? body.thank_you_url : undefined,
    ads: ads
      .filter((a): a is { ad_id: string; name: string } => !!a && typeof (a as Record<string, unknown>).ad_id === 'string')
      .map(a => ({ ad_id: a.ad_id.replace(/\D/g, ''), name: String(a.name ?? '').slice(0, 200) || a.ad_id })),
  };
}

export async function GET(req: Request) {
  const ctx = await admin();
  if (ctx instanceof NextResponse) return ctx;
  const clientId = new URL(req.url).searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  try {
    const [options, last] = await Promise.all([builderOptions(ctx.service, clientId), lastBuild(ctx.service, clientId)]);
    return NextResponse.json({ options, last });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = await admin();
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const inp = input(body);
  if (!inp.client_id) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  try {
    if (body.action === 'preview') {
      const p = await planBuild(ctx.service, inp);
      return NextResponse.json({ problems: p.problems, names: p.names });
    }
    if (body.action === 'build') return NextResponse.json(await build(ctx.service, inp));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
