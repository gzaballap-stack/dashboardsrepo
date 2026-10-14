-- Read-only share links, keyed by what they open. Today: 'b2b_report' — the
-- Meta media-buying brief / update, fetched by a Claude project. The token in
-- the URL is the credential; deleting the row kills the link.
create table if not exists share_links (
  key         text primary key,
  token       text not null unique,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table share_links enable row level security;
