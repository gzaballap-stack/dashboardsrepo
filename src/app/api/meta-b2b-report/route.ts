import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, validateWebhookSecret } from '@/lib/api-auth';
import { buildMetaReport, renderMarkdown } from '@/lib/meta-report';
import { buildBriefReport } from '@/lib/meta-report-brief';
import { getFunnelStats } from '@/lib/b2b-funnel';
import { createServiceClient } from '@/lib/supabase';

// Meta B2B prospecting report, built on demand.
//   GET ?format=md|json   (default md)   → the report
//   GET ?download=1                      → same, as a file download
//   GET ?mode=full                       → the full media-buying brief for a chat with no context
//   GET ?mode=update                     → the 7-day update for a chat that already has the brief
//   (no mode = the original L30/L7/L3 report)
//   GET ?asof=YYYY-MM-DD                 → build the report as it would have read on that day
// Auth: a signed-in dashboard user, `Authorization: Bearer <ADMIN_WEBHOOK_SECRET>`,
// or `?token=` = the read-only share link (share/route.ts) — what a Claude
// project fetches. The token only opens the report, nothing else.
// The "Download report" button on the TM Dashboard calls this; paste the .md
// into Hormozi AI (or a chat here) for the media-buying read.
//
// Env: META_ACCESS_TOKEN (required); optional META_B2B_ACCOUNT_ID,
//      META_REPORT_CAMPAIGNS (comma-separated exact names), META_KEPT_DEMO_EVENT (legacy META_KEPT_INTRO_EVENT), REPORT_TIMEZONE.

export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  let service;
  if (validateWebhookSecret(req)) {
    service = createServiceClient();
  } else if (url.searchParams.get('token')) {
    const svc = createServiceClient();
    const { data } = await svc.from('share_links').select('key').eq('key', 'b2b_report').eq('token', url.searchParams.get('token')!).maybeSingle();
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    service = svc;
  } else {
    const ctx = await getAuthContext();
    if (isAuthError(ctx)) return ctx;
    service = ctx.service;
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN is not set — add it to the environment variables.' }, { status: 503 });

  const campaigns = (url.searchParams.get('campaigns') ?? process.env.META_REPORT_CAMPAIGNS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  try {
    const download = url.searchParams.get('download') === '1';
    const mode = url.searchParams.get('mode');
    const funnelFor = (since: string, until: string, tz: string) => getFunnelStats(service, since, until, tz);
    const asof = url.searchParams.get('asof');
    const now = asof && /^\d{4}-\d{2}-\d{2}$/.test(asof) ? new Date(`${asof}T12:00:00Z`) : undefined;

    if (mode === 'full' || mode === 'update') {
      const { markdown } = await buildBriefReport({ token, campaigns, funnelFor, service, mode, now });
      const name = mode === 'full' ? 'b2b-full-brief' : 'b2b-update';
      return new NextResponse(markdown, { headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        // The brief is rebuilt on every request; nothing in between may serve a stale copy.
        'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
        'Pragma': 'no-cache',
        ...(download ? { 'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.md"` } : {}),
      } });
    }

    const report = await buildMetaReport({ token, campaigns, funnelFor, now });
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
