import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { date, platform } = payload;
    const service = createServiceClient();

    let amount: string | number | undefined = payload.amount;

    if (payload.meta_entity_id && payload.meta_access_token) {
      const spendDate = (date as string) || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const params = new URLSearchParams({
        fields: 'spend',
        time_range: JSON.stringify({ since: spendDate, until: spendDate }),
        access_token: payload.meta_access_token,
      });

      const metaRes = await fetch(
        `https://graph.facebook.com/v19.0/${payload.meta_entity_id}/insights?${params}`
      );
      const metaJson = await metaRes.json() as { data?: { spend?: string }[]; error?: { message: string } };
      if (metaJson.error) {
        return NextResponse.json({ error: `Meta API: ${metaJson.error.message}` }, { status: 502 });
      }
      amount = metaJson.data?.[0]?.spend ?? '0';
    }

    if (!date || !platform || amount === undefined) {
      return NextResponse.json({ error: 'date, platform, and amount are required' }, { status: 400 });
    }
    if (!['meta', 'google', 'local_services'].includes(platform)) {
      return NextResponse.json({ error: 'platform must be "meta", "google", or "local_services"' }, { status: 400 });
    }

    const { error } = await service
      .from('b2b_ad_spend')
      .upsert(
        { spend_date: date, platform, amount: parseFloat(String(amount)) || 0 },
        { onConflict: 'spend_date,platform' }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, date, platform, amount });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
