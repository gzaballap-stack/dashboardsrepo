import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, validateWebhookSecret } from '@/lib/api-auth';
import { buildMetaReport, renderMarkdown } from '@/lib/meta-report';
import { getFunnelStats } from '@/lib/b2b-funnel';
import { createServiceClient } from '@/lib/supabase';

// Meta B2B prospecting report, built on demand.
//   GET ?format=md|json   (default md)   → the report
//   GET ?download=1                      → same, as a file download
// Auth: a signed-in dashboard user, or `Authorization: Bearer <ADMIN_WEBHOOK_SECRET>`.
// The "Download report" button on the TM Dashboard calls this; paste the .md
// into Hormozi AI (or a chat here) for the media-buying read.
//
// Env: META_ACCESS_TOKEN (required); optional META_B2B_ACCOUNT_ID,
//      META_REPORT_CAMPAIGNS (comma-separated exact names), META_KEPT_INTRO_EVENT, REPORT_TIMEZONE.

export const maxDuration = 120;

export async function GET(req: Request) {
  let service;
  if (validateWebhookSecret(req)) {
    service = createServiceClient();
  } else {
    const ctx = await getAuthContext();
    if (isAuthError(ctx)) return ctx;
    service = ctx.service;
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN is not set — add it to the environment variables.' }, { status: 503 });

  const url = new URL(req.url);
  const campaigns = (url.searchParams.get('campaigns') ?? process.env.META_REPORT_CAMPAIGNS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  try {
    const report = await buildMetaReport({
      token, campaigns,
      funnelFor: (since, until, tz) => getFunnelStats(service, since, until, tz),
    });
    const download = url.searchParams.get('download') === '1';
    if (url.searchParams.get('format') === 'json') {
      return new NextResponse(JSON.stringify(report, null, 2), { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(download ? { 'Content-Disposition': `attachment; filename="meta-b2b-report-${report.today}.json"` } : {}),
      } });
    }
    return new NextResponse(renderMarkdown(report), { headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      ...(download ? { 'Content-Disposition': `attachment; filename="meta-b2b-report-${report.today}.md"` } : {}),
    } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
