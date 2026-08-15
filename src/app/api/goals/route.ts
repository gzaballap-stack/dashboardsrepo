import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const service = createServiceClient();

  let query = service.from('goals').select('*').order('metric');
  if (clientId) query = query.eq('client_id', clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goals: data });
}

export async function POST(req: Request) {
  const { client_id, agent_name, metric, target, period = 'monthly' } = await req.json();
  if (!client_id || !metric || target == null) {
    return NextResponse.json({ error: 'client_id, metric, and target are required' }, { status: 400 });
  }
  const service = createServiceClient();
  const { data, error } = await service
    .from('goals')
    .upsert({ client_id, agent_name: agent_name ?? null, metric, target: Number(target), period },
      { onConflict: 'client_id,agent_name,metric,period' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}
