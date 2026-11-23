import { NextResponse } from 'next/server';
import { hubAuth } from '@/lib/creative-hub-entries';
import { readAdTexts } from '@/lib/ad-texts';

/**
 * The texts an ad in Meta is actually running — every primary text, headline
 * and description on its creative (Advantage+ creatives carry several of
 * each), plus the button and the link. GET ?ad_id=
 */
export async function GET(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const adId = new URL(req.url).searchParams.get('ad_id');
  if (!adId || !/^\d+$/.test(adId)) return NextResponse.json({ error: 'ad_id required' }, { status: 400 });
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN is not set' }, { status: 503 });
  try {
    return NextResponse.json(await readAdTexts(adId, token));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
