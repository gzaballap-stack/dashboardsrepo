import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

// Accepts: { date, platform, adsets: [{ campaign_id, campaign_name, adset_id, adset_name, spend, impressions, reach, inline_link_clicks, ctr, cpc, cpm }] }

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { date, platform, adsets } = payload;

    if (!date || !platform) {
      return NextResponse.json({ error: 'date and platform are required' }, { status: 400 });
    }
    if (!['meta', 'google', 'local_services'].includes(platform)) {
      return NextResponse.json({ error: 'invalid platform' }, { status: 400 });
    }
    if (!Array.isArray(adsets) || adsets.length === 0) {
      return NextResponse.json({ success: true, inserted: 0, note: 'empty adsets array — nothing to insert' });
    }

    const service = createServiceClient();

    const records = adsets.map((a: Record<string, unknown>) => {
      const rec: Record<string, unknown> = {
        spend_date:    date,
        platform,
        campaign_id:   a.campaign_id   ? String(a.campaign_id)   : '',
        campaign_name: a.campaign_name ? String(a.campaign_name) : null,
        adset_id:      a.adset_id      ? String(a.adset_id)      : '',
        adset_name:    a.adset_name    ? String(a.adset_name)    : null,
        spend:         parseFloat(String(a.spend ?? 0)) || 0,
      };
      if (a.impressions       != null) rec.impressions  = parseInt(String(a.impressions), 10);
      if (a.reach             != null) rec.reach        = parseInt(String(a.reach),        10);
      const clicks = a.inline_link_clicks ?? a.link_clicks;
      if (clicks              != null) rec.link_clicks  = parseInt(String(clicks),          10);
      if (a.ctr               != null) rec.ctr          = parseFloat(String(a.ctr));
      if (a.cpc               != null) rec.cpc          = parseFloat(String(a.cpc));
      if (a.cpm               != null) rec.cpm          = parseFloat(String(a.cpm));
      return rec;
    });

    const { error } = await service
      .from('b2b_ad_sets')
      .upsert(records, { onConflict: 'spend_date,platform,campaign_id,adset_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, inserted: records.length });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
