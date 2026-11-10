import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { canBill, isMissingTable } from '@/lib/billing';
import { stripeStatus, findCustomers, createCustomer } from '@/lib/stripe';

// Client Billing — finding a client's customer record in Stripe, or creating
// one, so the roster client can be linked to it.
//
//   GET ?q=                       Stripe customers matching a name or email
//   POST { client_id, name, email }   create the customer in Stripe and link it

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  if (!(await canBill(ctx))) return bad('Client Billing is not enabled for this account', 403);
  if (!stripeStatus().configured) return bad('Stripe is not connected yet', 503);

  try {
    const customers = await findCustomers(new URL(req.url).searchParams.get('q') ?? '');
    return NextResponse.json({ customers });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Couldn't reach Stripe", 502);
  }
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  if (!(await canBill(ctx))) return bad('Client Billing is not enabled for this account', 403);
  if (!stripeStatus().configured) return bad('Stripe is not connected yet', 503);

  const body = await req.json().catch(() => ({}));
  const clientId = String(body.client_id ?? '');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!clientId || !name) return bad('A name is required');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("That email doesn't look right");

  const { data: client } = await ctx.service.from('clients').select('id').eq('id', clientId).maybeSingle();
  if (!client) return bad('Client not found', 404);

  let customer;
  try { customer = await createCustomer(name, email || null); }
  catch (e) { return bad(e instanceof Error ? e.message : "Couldn't reach Stripe", 502); }

  const { error } = await ctx.service.from('billing_clients')
    .upsert({ client_id: clientId, stripe_customer_id: customer.id, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
  if (error) {
    return isMissingTable(error)
      ? bad('Client Billing needs a one-off database update first', 503)
      : bad(error.message, 500);
  }
  return NextResponse.json({ customer });
}
