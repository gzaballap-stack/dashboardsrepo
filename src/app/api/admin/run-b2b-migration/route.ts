import { NextResponse } from 'next/server';
import { validateWebhookSecret } from '@/lib/api-auth';

const PROJECT_REF  = 'fsebiwzgjenjwiyujexl'; // V1 production
const MAKE_SCENARIO = 7112516;
// Tokens loaded from Railway env at call-time — never hardcoded here.
// MAKE_API_TOKEN   — Make.com API token (eu1)
// META_B2B_TOKEN   — Meta Graph API access token for act_1080664784142903

const MIGRATION_STEPS = [
  "ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS campaign_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS campaign_name TEXT",
  "ALTER TABLE b2b_ad_spend DROP CONSTRAINT IF EXISTS b2b_ad_spend_spend_date_platform_key",
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_ad_spend_spend_date_platform_campaign_key') THEN ALTER TABLE b2b_ad_spend ADD CONSTRAINT b2b_ad_spend_spend_date_platform_campaign_key UNIQUE(spend_date, platform, campaign_id); END IF; END$$`,
  // Ad set level table
  `CREATE TABLE IF NOT EXISTS b2b_ad_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    spend_date date NOT NULL, platform text NOT NULL,
    campaign_id text NOT NULL, campaign_name text,
    adset_id text NOT NULL, adset_name text,
    spend numeric NOT NULL DEFAULT 0, impressions integer, reach integer,
    link_clicks integer, ctr numeric, cpc numeric, cpm numeric,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT b2b_ad_sets_platform_check CHECK (platform IN ('meta','google','local_services')),
    UNIQUE(spend_date, platform, campaign_id, adset_id)
  )`,
  "CREATE INDEX IF NOT EXISTS b2b_ad_sets_date ON b2b_ad_sets(spend_date DESC)",
  "ALTER TABLE b2b_ad_sets ENABLE ROW LEVEL SECURITY",
  // Ad level table
  `CREATE TABLE IF NOT EXISTS b2b_ads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    spend_date date NOT NULL, platform text NOT NULL,
    campaign_id text NOT NULL, campaign_name text,
    adset_id text NOT NULL DEFAULT '', adset_name text,
    ad_id text NOT NULL, ad_name text,
    spend numeric NOT NULL DEFAULT 0, impressions integer, reach integer,
    link_clicks integer, ctr numeric, cpc numeric, cpm numeric,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT b2b_ads_platform_check CHECK (platform IN ('meta','google','local_services')),
    UNIQUE(spend_date, platform, campaign_id, adset_id, ad_id)
  )`,
  "CREATE INDEX IF NOT EXISTS b2b_ads_date ON b2b_ads(spend_date DESC)",
  "ALTER TABLE b2b_ads ENABLE ROW LEVEL SECURITY",
];

// 2-module blueprint: fetch all campaigns from Meta in one call → POST array to /batch endpoint.
// Avoids the Iterator module (tools:BasicIterator) which Make rejects via API.
function buildBlueprint(metaToken: string, webhookSecret: string) { return {
  name: "CCM - B2B Meta Spend → Supabase",
  flow: [
    {
      id: 1, module: "http:ActionSendData", version: 3,
      parameters: { handleErrors: false, useNewZLibDeCompression: true },
      mapper: {
        url: "https://graph.facebook.com/v19.0/act_1080664784142903/insights",
        method: "get", headers: [], parseResponse: true, gzip: true,
        bodyType: "raw", contentType: "application/json", data: "",
        serializeUrl: false, followAllRedirects: false, useQuerystring: false,
        shareCookies: false, ca: "", useMtls: false, followRedirect: true,
        rejectUnauthorized: true, authUser: "", authPass: "", timeout: "",
        qs: [
          { name: "fields",       value: "campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,ctr,cpc,cpm" },
          { name: "time_range",   value: '{"since": "{{formatDate(addDays(now; -1); \\"YYYY-MM-DD\\")}}", "until": "{{formatDate(addDays(now; -1); \\"YYYY-MM-DD\\")}}"}' },
          { name: "level",        value: "campaign" },
          { name: "access_token", value: metaToken },
        ],
      },
      metadata: { designer: { x: 0, y: 0, name: "Fetch Meta Campaign Insights" } },
    },
    {
      id: 2, module: "http:ActionSendData", version: 3,
      parameters: { handleErrors: false, useNewZLibDeCompression: true },
      mapper: {
        url: "https://dashboard.tomsimedia.com/api/b2b-ad-spend/batch",
        method: "post", qs: [], parseResponse: false, gzip: true,
        bodyType: "raw", contentType: "application/json",
        serializeUrl: false, followAllRedirects: false, useQuerystring: false,
        shareCookies: false, ca: "", useMtls: false, followRedirect: true,
        rejectUnauthorized: true, authUser: "", authPass: "", timeout: "",
        headers: [
          { name: "Authorization", value: `Bearer ${webhookSecret}` },
          { name: "Content-Type",  value: "application/json" },
        ],
        data: '{"date":"{{formatDate(addDays(now;-1);\\"YYYY-MM-DD\\")}}","platform":"meta","campaigns":{{1.data}}}',
      },
      metadata: { designer: { x: 400, y: 0, name: "Send All Campaigns to Dashboard" } },
    },
    {
      id: 3, module: "http:ActionSendData", version: 3,
      parameters: { handleErrors: false, useNewZLibDeCompression: true },
      mapper: {
        url: "https://graph.facebook.com/v19.0/act_1080664784142903/insights",
        method: "get", headers: [], parseResponse: true, gzip: true,
        bodyType: "raw", contentType: "application/json", data: "",
        serializeUrl: false, followAllRedirects: false, useQuerystring: false,
        shareCookies: false, ca: "", useMtls: false, followRedirect: true,
        rejectUnauthorized: true, authUser: "", authPass: "", timeout: "",
        qs: [
          { name: "fields",       value: "adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,ctr,cpc,cpm" },
          { name: "time_range",   value: '{"since": "{{formatDate(addDays(now; -1); \\"YYYY-MM-DD\\")}}", "until": "{{formatDate(addDays(now; -1); \\"YYYY-MM-DD\\")}}"}' },
          { name: "level",        value: "adset" },
          { name: "access_token", value: metaToken },
        ],
      },
      metadata: { designer: { x: 0, y: 200, name: "Fetch Meta Ad Set Insights" } },
    },
    {
      id: 4, module: "http:ActionSendData", version: 3,
      parameters: { handleErrors: false, useNewZLibDeCompression: true },
      mapper: {
        url: "https://dashboard.tomsimedia.com/api/b2b-ad-spend/batch-adsets",
        method: "post", qs: [], parseResponse: false, gzip: true,
        bodyType: "raw", contentType: "application/json",
        serializeUrl: false, followAllRedirects: false, useQuerystring: false,
        shareCookies: false, ca: "", useMtls: false, followRedirect: true,
        rejectUnauthorized: true, authUser: "", authPass: "", timeout: "",
        headers: [
          { name: "Authorization", value: `Bearer ${webhookSecret}` },
          { name: "Content-Type",  value: "application/json" },
        ],
        data: '{"date":"{{formatDate(addDays(now;-1);\\"YYYY-MM-DD\\")}}","platform":"meta","adsets":{{3.data}}}',
      },
      metadata: { designer: { x: 400, y: 200, name: "Send All Ad Sets to Dashboard" } },
    },
    {
      id: 5, module: "http:ActionSendData", version: 3,
      parameters: { handleErrors: false, useNewZLibDeCompression: true },
      mapper: {
        url: "https://graph.facebook.com/v19.0/act_1080664784142903/insights",
        method: "get", headers: [], parseResponse: true, gzip: true,
        bodyType: "raw", contentType: "application/json", data: "",
        serializeUrl: false, followAllRedirects: false, useQuerystring: false,
        shareCookies: false, ca: "", useMtls: false, followRedirect: true,
        rejectUnauthorized: true, authUser: "", authPass: "", timeout: "",
        qs: [
          { name: "fields",       value: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,ctr,cpc,cpm" },
          { name: "time_range",   value: '{"since": "{{formatDate(addDays(now; -1); \\"YYYY-MM-DD\\")}}", "until": "{{formatDate(addDays(now; -1); \\"YYYY-MM-DD\\")}}"}' },
          { name: "level",        value: "ad" },
          { name: "access_token", value: metaToken },
        ],
      },
      metadata: { designer: { x: 0, y: 400, name: "Fetch Meta Ad Insights" } },
    },
    {
      id: 6, module: "http:ActionSendData", version: 3,
      parameters: { handleErrors: false, useNewZLibDeCompression: true },
      mapper: {
        url: "https://dashboard.tomsimedia.com/api/b2b-ad-spend/batch-ads",
        method: "post", qs: [], parseResponse: false, gzip: true,
        bodyType: "raw", contentType: "application/json",
        serializeUrl: false, followAllRedirects: false, useQuerystring: false,
        shareCookies: false, ca: "", useMtls: false, followRedirect: true,
        rejectUnauthorized: true, authUser: "", authPass: "", timeout: "",
        headers: [
          { name: "Authorization", value: `Bearer ${webhookSecret}` },
          { name: "Content-Type",  value: "application/json" },
        ],
        data: '{"date":"{{formatDate(addDays(now;-1);\\"YYYY-MM-DD\\")}}","platform":"meta","ads":{{5.data}}}',
      },
      metadata: { designer: { x: 400, y: 400, name: "Send All Ads to Dashboard" } },
    },
  ],
  metadata: {
    instant: false, version: 1,
    scenario: { roundtrips: 1, maxErrors: 3, autoCommit: true, autoCommitTriggerLast: true, sequential: false, confidential: false, dataloss: false, dlq: false, freshVariables: false },
    designer: { orphans: [] }, zone: "eu1.make.com",
  },
}; }

// GET — lists Make scenarios so we can verify the scenario ID from Railway's network
export async function GET(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const makeToken = searchParams.get('mk') || process.env.MAKE_API_TOKEN || '';
  const res = await fetch(
    `https://eu1.make.com/api/v2/scenarios?teamId=875675&folderId=356178`,
    { headers: { Authorization: `Token ${makeToken}` } }
  );
  const body = await res.json().catch(() => ({}));
  return NextResponse.json({ status: res.status, scenarios: (body.scenarios ?? []).map((s: {id:number;name:string}) => ({ id: s.id, name: s.name })) });
}

async function runSQL(query: string, accessToken: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }
  );
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Prefer env vars; accept body overrides for one-shot admin calls
  const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN || body.supabase_token;
  const makeToken     = process.env.MAKE_API_TOKEN        || body.make_token;
  const metaToken     = process.env.META_B2B_TOKEN        || body.meta_token;

  if (!supabaseToken) return NextResponse.json({ error: 'SUPABASE_ACCESS_TOKEN not set' }, { status: 500 });

  // 1. Run DB migration (runs even without Make/Meta tokens)
  const dbResults = [];
  for (const sql of MIGRATION_STEPS) {
    const r = await runSQL(sql, supabaseToken);
    dbResults.push({ sql: sql.slice(0, 80), ok: r.ok, status: r.status });
  }

  // 2. Update Make scenario blueprint (only if both tokens are present)
  if (!makeToken || !metaToken) {
    return NextResponse.json({
      success: true,
      db: dbResults,
      make: { skipped: true, reason: !makeToken ? 'MAKE_API_TOKEN not set' : 'META_B2B_TOKEN not set' },
    });
  }

  const webhookSecret = process.env.ADMIN_WEBHOOK_SECRET || '';
  const blueprint = buildBlueprint(metaToken, webhookSecret);
  const makeRes = await fetch(
    `https://eu1.make.com/api/v2/scenarios/${MAKE_SCENARIO}?teamId=875675`,
    {
      method: 'PATCH',
      headers: { Authorization: `Token ${makeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint: JSON.stringify(blueprint) }),
    }
  );
  const makeBody = await makeRes.json().catch(() => ({}));

  return NextResponse.json({
    success: true,
    db: dbResults,
    make: { ok: makeRes.ok, status: makeRes.status, body: makeBody },
  });
}
