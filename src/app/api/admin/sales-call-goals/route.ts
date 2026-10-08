import { NextResponse } from 'next/server';
import { validateWebhookSecret } from '@/lib/api-auth';
import { computeGoals, parseDocId, GOAL_TAGS } from '@/lib/goal-math';

type GHLCustomField = { key: string; value: string };

// Fired from a GHL workflow when the prospect's revenue numbers are filled in
// (average_job / current_revenue / revenue_goal, optional close_rate). Returns
// the derived figures plus a ready-made find/replace list, so Make can write
// them into the existing Custom Area Breakdown doc with one "Replace text" step.
//
// Accepts the flat shape ({ average_job, ... }), GHL customData, or the native
// GHL webhook shape ({ contact: { customField: [...] } }).
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const customData = (body.customData ?? body.custom_data ?? {}) as Record<string, unknown>;
  const ghlContact = (body.contact ?? body.Contact ?? null) as { customField?: GHLCustomField[] } | null;
  const fields: GHLCustomField[] = ghlContact?.customField ?? [];

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k] ?? customData[k] ?? fields.find(f => f.key === k)?.value;
      if (v != null && String(v).trim() !== '') return v;
    }
    return undefined;
  };

  const result = computeGoals({
    average_job:     pick('average_job', 'Average Job', 'avg_job'),
    current_revenue: pick('current_revenue', 'Current Revenue'),
    revenue_goal:    pick('revenue_goal', 'Revenue Goal'),
    close_rate:      pick('close_rate', 'Close Rate'),
  });

  const doc_id = parseDocId(pick('doc_id', 'doc_url', 'area_breakdown_doc', 'Area Breakdown Doc', 'document_url'));

  // Make's Google Docs "Replace a Text" module takes an array of {find, replace}.
  const replacements = GOAL_TAGS.map(t => ({ find: `{{${t}}}`, replace: result.doc[t] }));

  return NextResponse.json({
    success: true,
    complete: result.complete,
    missing: result.missing,
    doc_id,
    ...result.doc,
    numbers: result.numbers,
    replacements,
  });
}
