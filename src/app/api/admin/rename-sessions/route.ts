import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

/**
 * Find-and-replace across saved Zip Tool session names.
 *
 * Sessions created from GHL were named "<company> (Sales Call)", which is
 * internal language that ends up in front of the prospect. New ones are named
 * "(Custom Area Breakdown)"; this fixes the ones already saved.
 *
 * POST { find: string, replace: string, dry_run?: boolean }
 *
 * dry_run defaults to TRUE. Matching is a plain substring, case-sensitive.
 */
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const find    = typeof body.find === 'string' ? body.find : '';
  const replace = typeof body.replace === 'string' ? body.replace : '';
  const dryRun  = body.dry_run !== false;

  if (!find) return NextResponse.json({ error: 'find is required' }, { status: 400 });

  const service = createServiceClient();

  const { data, error } = await service
    .from('client_sessions')
    .select('id, name')
    .like('name', `%${find}%`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ dry_run: dryRun, matched: 0, message: 'Nothing to rename' });

  const renames = data.map(s => ({ id: s.id, from: s.name, to: (s.name as string).split(find).join(replace) }));

  let renamed = 0;
  const errors: string[] = [];

  if (!dryRun) {
    for (const r of renames) {
      const { error: ue } = await service
        .from('client_sessions')
        .update({ name: r.to, updated_at: new Date().toISOString() })
        .eq('id', r.id);
      if (ue) errors.push(`${r.from}: ${ue.message}`);
      else renamed++;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    matched: renames.length,
    renamed: dryRun ? 0 : renamed,
    sample: renames.slice(0, 10).map(r => `${r.from}  →  ${r.to}`),
    errors: errors.slice(0, 5),
  });
}
