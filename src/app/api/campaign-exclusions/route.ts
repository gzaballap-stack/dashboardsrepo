import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Campaigns hidden from the Campaign Overview page/rollups per client -- ad accounts
// often carry other agencies' or legacy campaigns alongside the ones actually run by
// Tomsi Media, so this is an opt-out list (absence = included) rather than a per-row
// flag on ad_campaigns, which would need re-applying every time a new day's data lands.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');

  let query = ctx.service.from('ad_campaign_exclusions').select('client_id, campaign_id');
  if (client_id) query = query.eq('client_id', client_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ exclusions: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { client_id, campaign_id } = await req.json();
  if (!client_id || !campaign_id) {
    return NextResponse.json({ error: 'client_id and campaign_id are required' }, { status: 400 });
  }

  const { error } = await ctx.service
    .from('ad_campaign_exclusions')
    .upsert({ client_id, campaign_id }, { onConflict: 'client_id,campaign_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  const campaign_id = searchParams.get('campaign_id');
  if (!client_id || !campaign_id) {
    return NextResponse.json({ error: 'client_id and campaign_id are required' }, { status: 400 });
  }

  const { error } = await ctx.service
    .from('ad_campaign_exclusions')
    .delete()
    .eq('client_id', client_id)
    .eq('campaign_id', campaign_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
