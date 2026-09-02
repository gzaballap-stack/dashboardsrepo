import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('clients')
    .select('id, name, is_live, share_token, created_at')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data });
}

// Sales-call sessions land in the Zip Tool named after the prospect's company —
// "Acme Kitchens (Sales Call)". Once that prospect becomes a client, the session
// should follow them across, so match on the name with the noise stripped out.
function matchKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(sales call\)/g, '')
    .replace(/\b(llc|inc|co|corp|ltd|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { name, session_id } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('clients')
    .insert({ name: name.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Move the prospect's territory session from Sessions into Clients automatically:
  // an explicitly chosen one, else the newest unattached session whose name matches.
  let linked_session: { id: string; name: string } | null = null;
  const { data: loose } = await ctx.service
    .from('client_sessions')
    .select('id, name')
    .is('client_id', null)
    .order('updated_at', { ascending: false });

  const key = matchKey(name);
  const match = session_id
    ? (loose ?? []).find(s => s.id === session_id)
    : (loose ?? []).find(s => {
        const k = matchKey(s.name);
        return k.length > 2 && key.length > 2 && (k === key || k.includes(key) || key.includes(k));
      });

  if (match) {
    const { error: linkError } = await ctx.service
      .from('client_sessions')
      .update({ client_id: data.id, updated_at: new Date().toISOString() })
      .eq('id', match.id);
    if (!linkError) linked_session = match;
  }

  return NextResponse.json({ client: data, linked_session });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service.from('clients').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
