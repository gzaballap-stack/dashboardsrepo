const PROJECT_ID = 'raboufpmctaeqgbrxppy';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) { console.error('SUPABASE_ACCESS_TOKEN not set'); process.exit(1); }

const SQL = `
alter table events add column if not exists revenue numeric not null default 0;
alter table events drop constraint if exists events_event_type_check;
alter table events add constraint events_event_type_check check (
  event_type in ('dial','lead','appointment_booked','show','no_show','callback_booked','closed')
);
`;

async function run() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Migration failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log('✓ Migration complete');
}

run().catch(console.error);
