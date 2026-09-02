import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { zipCreativeBreakdown, ZIP_METRIC_EVENTS, normalizeZip, type ZipMetric } from '@/lib/zip-rollup';

// Which ads / creatives produced one zip's leads, appointments, shows or closes.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  const zip       = normalizeZip(searchParams.get('zip'));
  const metric    = searchParams.get('metric') as ZipMetric | null;

  if (!client_id || !zip) {
    return NextResponse.json({ error: 'client_id and zip are required' }, { status: 400 });
  }
  if (!metric || !(metric in ZIP_METRIC_EVENTS)) {
    return NextResponse.json(
      { error: `metric must be one of: ${Object.keys(ZIP_METRIC_EVENTS).join(', ')}` },
      { status: 400 }
    );
  }

  const breakdown = await zipCreativeBreakdown(ctx.service, client_id, zip, metric);

  return NextResponse.json({
    zip,
    metric,
    total: breakdown.reduce((n, r) => n + r.count, 0),
    breakdown,
  });
}
