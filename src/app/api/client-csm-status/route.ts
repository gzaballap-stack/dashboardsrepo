import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const VALID_UPSELL = ['none', 'attempted', 'closed_won', 'closed_lost'] as const;

// One row per client holding CSM-managed fields (cadence, review status, upsell status).
// Upserted as a whole -- the UI always sends the full current state back, not partial patches.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { client_id } = body;
  if (!client_id) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });

  if (body.upsell_status && !VALID_UPSELL.includes(body.upsell_status)) {
    return NextResponse.json({ error: `upsell_status must be one of ${VALID_UPSELL.join(', ')}` }, { status: 400 });
  }

  const payload = {
    client_id,
    cadence_days: body.cadence_days ?? 14,
    csm_name: body.csm_name ?? null,
    left_review: body.left_review ?? false,
    review_date: body.review_date ?? null,
    review_platform: body.review_platform ?? null,
    review_link: body.review_link ?? null,
    upsell_status: body.upsell_status ?? 'none',
    upsell_notes: body.upsell_notes ?? null,
    upsell_date: body.upsell_date ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await ctx.service
    .from('client_csm_status')
    .upsert(payload, { onConflict: 'client_id' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: data });
}
