import { NextResponse } from 'next/server';
import { validateWebhookSecret } from '@/lib/api-auth';
import { buildMetaReport, renderMarkdown, renderSlackText, WINDOWS, type WindowDays } from '@/lib/meta-report';
import { postMessage, postWebhook, uploadFiles } from '@/lib/slack';

// Meta B2B prospecting report.
//   GET  ?format=json|md          → build and return the report (no Slack)
//   POST { dry_run?: boolean }    → build and post to Slack (summary message + report.md + report.json)
// Both need `Authorization: Bearer <ADMIN_WEBHOOK_SECRET>`.
// Scheduled Mon/Wed/Fri 08:00 ET by the "CCM - Meta B2B Report → Slack" Make scenario.
//
// Env: META_ACCESS_TOKEN (required), SLACK_BOT_TOKEN + SLACK_CHANNEL_ID (or SLACK_WEBHOOK_URL),
//      optional META_B2B_ACCOUNT_ID, META_REPORT_CAMPAIGNS (comma-separated exact names),
//      META_KEPT_INTRO_EVENT, REPORT_TIMEZONE.

export const maxDuration = 120;

function config(url: URL) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { error: 'META_ACCESS_TOKEN is not set — add it to the environment variables.' };

  const campaignsParam = url.searchParams.get('campaigns') ?? process.env.META_REPORT_CAMPAIGNS ?? '';
  const campaigns = campaignsParam.split(',').map(s => s.trim()).filter(Boolean);
  const fw = Number(url.searchParams.get('flag_window') ?? process.env.META_FLAG_WINDOW ?? 7);
  const flagWindow = (WINDOWS as readonly number[]).includes(fw) ? (fw as WindowDays) : 7;
  return { token, campaigns, flagWindow };
}

export async function GET(req: Request) {
  if (!validateWebhookSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const cfg = config(url);
  if ('error' in cfg) return NextResponse.json({ error: cfg.error }, { status: 503 });

  try {
    const report = await buildMetaReport({ token: cfg.token, campaigns: cfg.campaigns, flagWindow: cfg.flagWindow });
    if (url.searchParams.get('format') === 'md') {
      return new NextResponse(renderMarkdown(report), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
    }
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const cfg = config(url);
  if ('error' in cfg) return NextResponse.json({ error: cfg.error }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean };
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!body.dry_run && !(botToken && channel) && !webhook) {
    return NextResponse.json({ error: 'Slack is not configured — set SLACK_BOT_TOKEN + SLACK_CHANNEL_ID (or SLACK_WEBHOOK_URL).' }, { status: 503 });
  }

  try {
    const report = await buildMetaReport({ token: cfg.token, campaigns: cfg.campaigns, flagWindow: cfg.flagWindow });
    const text = renderSlackText(report);
    const markdown = renderMarkdown(report);

    if (body.dry_run) {
      return NextResponse.json({ success: true, dry_run: true, slack_text: text, ads: report.ads.length, summary: report.summary });
    }

    let delivery: string;
    if (botToken && channel) {
      const ts = await postMessage(botToken, channel, text);
      await uploadFiles(botToken, channel, [
        { filename: `meta-b2b-report-${report.today}.md`, title: `Ad-level tables — ${report.today}`, content: markdown },
        { filename: `meta-b2b-report-${report.today}.json`, title: `Report data (JSON) — ${report.today}`, content: JSON.stringify(report, null, 2) },
      ], ts);
      delivery = 'bot';
    } else {
      await postWebhook(webhook!, text + '\n\n_Full tables + JSON need a Slack bot token (SLACK_BOT_TOKEN) — webhook delivery is summary only._');
      delivery = 'webhook';
    }

    return NextResponse.json({ success: true, delivery, ads: report.ads.length, summary: report.summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
