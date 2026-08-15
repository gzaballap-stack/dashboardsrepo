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

    // If meta_entity_id is provided, fetch spend from Meta API server-side
    // so Make doesn't need to parse the response with template expressions
    if (payload.meta_entity_id && payload.meta_access_token) {
      const spendDate = (date as string) || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const params = new URLSearchParams({
        fields: 'spend',
        time_range: JSON.stringify({ since: spendDate, until: spendDate }),
        access_token: payload.meta_access_token,
      });
      if (payload.meta_level) params.set('level', payload.meta_level);

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

    let client_id = payload.client_id as string | undefined;

    if (!client_id && payload.client_name) {
      const { data: client } = await service
        .from('clients')
        .select('id')
        .eq('name', payload.client_name)
        .single();
      if (!client) {
        return NextResponse.json({ error: `Client "${payload.client_name}" not found` }, { status: 400 });
      }
      client_id = client.id;
    }

    if (!client_id) {
      return NextResponse.json({ error: 'client_id or client_name is required' }, { status: 400 });
    }

    const { error } = await service.from('ad_spend').upsert(
      { client_id, spend_date: date, platform, amount: Number(amount) },
      { onConflict: 'client_id,spend_date,platform' }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, amount: Number(amount) });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
