import { NextResponse } from 'next/server';
import { hubAuth } from '@/lib/creative-hub-entries';

/**
 * The texts an ad in Meta is actually running — every primary text, headline
 * and description on its creative (Advantage+ creatives carry several of
 * each), plus the button and the link. GET ?ad_id=
 */

type Raw = {
  name?: string;
  creative?: {
    title?: string; body?: string;
    object_story_spec?: {
      video_data?: { message?: string; title?: string; link_description?: string; call_to_action?: { type?: string; value?: { link?: string } } };
      link_data?: { message?: string; name?: string; description?: string; link?: string; call_to_action?: { type?: string; value?: { link?: string } } };
    };
    asset_feed_spec?: {
      bodies?: { text?: string }[]; titles?: { text?: string }[]; descriptions?: { text?: string }[];
      call_to_action_types?: string[]; link_urls?: { website_url?: string }[];
    };
  };
  error?: { message?: string };
};

const uniq = (list: (string | undefined)[]) => [...new Set(list.map(s => s?.trim()).filter((s): s is string => !!s))];

export async function GET(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const adId = new URL(req.url).searchParams.get('ad_id');
  if (!adId || !/^\d+$/.test(adId)) return NextResponse.json({ error: 'ad_id required' }, { status: 400 });
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN is not set' }, { status: 503 });

  const fields = 'name,creative{title,body,object_story_spec,asset_feed_spec}';
  const res = await fetch(`https://graph.facebook.com/v19.0/${adId}?fields=${encodeURIComponent(fields)}&access_token=${token}`, { signal: AbortSignal.timeout(15_000) });
  const raw = await res.json() as Raw;
  if (raw.error) return NextResponse.json({ error: `Meta: ${raw.error.message}` }, { status: 502 });

  const c = raw.creative ?? {};
  const oss = c.object_story_spec;
  const afs = c.asset_feed_spec;
  const ld = oss?.link_data, vd = oss?.video_data;
  return NextResponse.json({
    ad_name: raw.name ?? null,
    bodies: uniq([...(afs?.bodies ?? []).map(b => b.text), c.body, ld?.message, vd?.message]),
    headlines: uniq([...(afs?.titles ?? []).map(t => t.text), c.title, ld?.name, vd?.title]),
    descriptions: uniq([...(afs?.descriptions ?? []).map(d => d.text), ld?.description, vd?.link_description]),
    cta: afs?.call_to_action_types?.[0] ?? ld?.call_to_action?.type ?? vd?.call_to_action?.type ?? null,
    link: afs?.link_urls?.[0]?.website_url ?? ld?.link ?? ld?.call_to_action?.value?.link ?? vd?.call_to_action?.value?.link ?? null,
  });
}
