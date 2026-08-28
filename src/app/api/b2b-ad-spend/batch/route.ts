import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

// Accepts: { date, platform, campaigns: [{ campaign_id, campaign_name, spend, impressions, reach, inline_link_clicks, ctr, cpc, cpm }] }
// Make sends the full Meta campaign-level data array in one POST, avoiding the Iterator module.

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { date, platform, campaigns } = payload;

    if (!date || !platform) {
      return NextResponse.json({ error: 'date and platform are required' }, { status: 400 });
    }
    if (!['meta', 'google', 'local_services'].includes(platform)) {
      return NextResponse.json({ error: 'platform must be "meta", "google", or "local_services"' }, { status: 400 });
    }
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ error: 'campaigns array is required and must be non-empty' }, { status: 400 });
    }

    const service = createServiceClient();

    const records = campaigns.map((c: Record<string, unknown>) => {
      const record: Record<string, unknown> = {
        spend_date:    date,
        platform,
        campaign_id:   c.campaign_id   ? String(c.campaign_id)   : '',
        campaign_name: c.campaign_name ? String(c.campaign_name) : null,
        amount:        parseFloat(String(c.spend ?? c.amount ?? 0)) || 0,
      };
      if (c.impressions       != null) record.impressions  = parseInt(String(c.impressions),       10);
      if (c.reach             != null) record.reach        = parseInt(String(c.reach),             10);
      const clicks = c.inline_link_clicks ?? c.link_clicks;
      if (clicks              != null) record.link_clicks  = parseInt(String(clicks),              10);
      if (c.ctr               != null) record.ctr          = parseFloat(String(c.ctr));
      if (c.cpc               != null) record.cpc          = parseFloat(String(c.cpc));
      if (c.cpm               != null) record.cpm          = parseFloat(String(c.cpm));
      return record;
    });

    const { error } = await service
      .from('b2b_ad_spend')
      .upsert(records, { onConflict: 'spend_date,platform,campaign_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, inserted: records.length });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
