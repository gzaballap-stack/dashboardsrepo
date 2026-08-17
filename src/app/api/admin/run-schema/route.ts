import { NextResponse } from 'next/server';
import { validateWebhookSecret } from '@/lib/api-auth';

const PROJECT_REF = 'raboufpmctaeqgbrxppy';

const ZIP_PERFORMANCE_SQL = `
create table if not exists zip_performance (
  id           uuid    primary key default gen_random_uuid(),
  client_id    uuid    not null references clients(id) on delete cascade,
  zip_code     text    not null,
  leads        int     not null default 0,
  appointments int     not null default 0,
  shows        int     not null default 0,
  closes       int     not null default 0,
  revenue      numeric(12,2) not null default 0,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(client_id, zip_code)
);
create index if not exists zip_perf_client on zip_performance(client_id);
`.trim();

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: 'SUPABASE_ACCESS_TOKEN not set' }, { status: 500 });
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: ZIP_PERFORMANCE_SQL }),
    }
  );

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({ error: 'Management API error', detail: body }, { status: 500 });
  }

  return NextResponse.json({ success: true, result: body });
}
