// New client survey — what submitting it does. One submission sets the client
// up everywhere: Client Roster, the shared client profile (Profit and Loss and
// Client Billing read it), Client Billing (price, Stripe customer) and the
// Onboarding board (one card per service). See NOTES.md 2026-11-12.

import type { AuthContext } from './api-auth';
import { canBill, round2, toCents } from './billing';
import {
  billingEmail, cashOf, cleanAnswers, contactName, mainPhone, prepaidOf, priceOf, serviceOf, str, surveyProblem, tracksOf,
  type Answers,
} from './client-survey';
import { markClosedInGhl } from './ghl-close';
import { snapshot, type Card } from './onboarding';
import { coveredSteps, createCard, ensureRoster, ensureRosterFor, readTemplates, tablesMissing } from './onboarding-server';
import { StripeError, createCardSetupLink, createCustomer, findCustomers, stripeStatus } from './stripe';

type Service = AuthContext['service'];
type Row = Record<string, unknown>;
export type Outcome = { status: number; json: Record<string, unknown> };

const fail = (error: string, status = 400): Outcome => ({ status, json: { error } });
const NEEDS_SETUP = 'The survey needs a one-off database update first (node scripts/migrate-onboarding.mjs v1)';
const now = () => new Date().toISOString();

/** Who did it — the part of their email before the @. */
export async function whoIs(ctx: AuthContext): Promise<string> {
  const { data } = await ctx.service.auth.admin.getUserById(ctx.userId).catch(() => ({ data: null }));
  return data?.user?.email?.split('@')[0] ?? 'someone';
}

export async function readSurvey(service: Service, clientId: string): Promise<Outcome> {
  const { data, error } = await service.from('client_surveys')
    .select('answers, submitted_by_name, created_at, updated_at').eq('client_id', clientId).maybeSingle();
  if (error) return tablesMissing(error) ? { status: 200, json: { ready: false, survey: null } } : fail(error.message ?? 'Could not read the survey', 500);
  return { status: 200, json: { ready: true, survey: data ?? null } };
}

/**
 * The client's customer record in Stripe: the one already linked in Client
 * Billing, else the one Stripe already has under that exact email (so a client
 * who has paid before is not given a second record), else a new one.
 */
export async function ensureStripeCustomer(
  service: Service, clientId: string, name: string, email: string | null,
): Promise<{ id?: string; made?: 'existing' | 'linked' | 'created'; error?: string }> {
  if (!stripeStatus().configured) return { error: 'Stripe is not connected here' };
  const { data, error } = await service.from('billing_clients').select('stripe_customer_id').eq('client_id', clientId).maybeSingle();
  if (error) return { error: tablesMissing(error) ? 'Client Billing is not set up on this database' : (error.message ?? 'Could not read Client Billing') };
  const linked = (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (linked) return { id: linked, made: 'existing' };

  let id: string;
  let made: 'linked' | 'created' = 'created';
  try {
    const same = email ? (await findCustomers(email)).filter(c => (c.email ?? '').toLowerCase() === email.toLowerCase()) : [];
    if (same.length === 1) { id = same[0].id; made = 'linked'; }
    else id = (await createCustomer(name, email)).id;
  } catch (e) {
    return { error: e instanceof StripeError || e instanceof Error ? e.message : "Couldn't reach Stripe" };
  }
  const { error: saveErr } = await service.from('billing_clients')
    .upsert({ client_id: clientId, stripe_customer_id: id, updated_at: now() }, { onConflict: 'client_id' });
  if (saveErr) return { error: saveErr.message ?? 'Could not save the Stripe link' };
  return { id, made };
}

/** Stripe's page for putting this card's client's card on file. */
export async function cardLink(service: Service, card: Card, origin: string): Promise<Outcome> {
  if (!stripeStatus().configured) return fail('Stripe is not connected here, so there is no card link to give out', 503);
  const roster = await ensureRoster(service, card);
  if (roster.error || !roster.client_id) return fail(roster.error ?? 'Could not add the client to the roster', 500);
  if (!card.client_id) await service.from('onboarding_cards').update({ client_id: roster.client_id, updated_at: now() }).eq('id', card.id);
  const customer = await ensureStripeCustomer(service, roster.client_id, card.client_name, card.contact_email);
  if (customer.error || !customer.id) return fail(customer.error ?? 'Could not set the client up in Stripe', 502);
  try {
    const url = await createCardSetupLink(customer.id, `${origin}/report/card-saved`);
    return { status: 200, json: { url, client_id: roster.client_id } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't reach Stripe", 502);
  }
}

/**
 * Contact details go on the shared client profile. Profiles are per user, so
 * the person submitting and every admin get it — otherwise a survey a VA fills
 * in would never reach the owner's Profit and Loss or Client Billing. Details
 * already on a profile are left alone; only blanks are filled.
 */
async function writeProfiles(ctx: AuthContext, clientId: string, name: string, a: Answers): Promise<string | null> {
  const { service } = ctx;
  const want: Row = {
    contact_name: contactName(a) || null, email: billingEmail(a) || null,
    phone: mainPhone(a) || null, website: str(a, 'website') || null,
  };
  const { data: admins } = await service.from('profiles').select('id').eq('is_admin', true);
  const users = new Set<string>([ctx.userId, ...((admins ?? []) as Row[]).map(p => String(p.id))]);
  const key = name.trim().toLowerCase();

  for (const user of users) {
    const { data, error } = await service.from('pnl_clients')
      .select('id, name_key, client_id, contact_name, email, phone, website').eq('user_id', user);
    if (error) return 'The client profile could not be saved (Profit and Loss needs its database update)';
    const rows = (data ?? []) as Row[];
    const mine = rows.find(r => r.client_id === clientId) ?? rows.find(r => r.name_key === key);
    if (mine) {
      const patch: Row = {};
      for (const [k, v] of Object.entries(want)) if (v && !mine[k]) patch[k] = v;
      if (!mine.client_id) patch.client_id = clientId;
      if (Object.keys(patch).length) {
        const { error: e } = await service.from('pnl_clients').update({ ...patch, updated_at: now() }).eq('id', mine.id as string);
        if (e) return 'The client profile could not be saved';
      }
    } else {
      const { error: e } = await service.from('pnl_clients').insert({ user_id: user, name_key: key, name: name.trim(), ...want, client_id: clientId });
      if (e) return 'The client profile could not be saved';
    }
  }
  return null;
}

const SURVEY_CREDIT = 'Onboarding survey';
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/**
 * "Paid up front" → Client Billing, once per client: the prepaid appointments
 * become credits (count × their price, so their next bookings are covered and
 * never billed), and the cash becomes a payment already made (nothing is sent
 * to Stripe). Saving the survey again never does either a second time — a
 * change after that is made in Client Billing. These records decide what a
 * client is billed, so they take Client Billing access; without it the answers
 * are kept on the survey and applied when someone with access saves it.
 */
async function applyPrepaid(
  ctx: AuthContext, clientId: string, clientName: string, a: Answers, surveyPrice: number | null,
): Promise<{ done: string[]; warnings: string[] }> {
  const { service } = ctx;
  const count = prepaidOf(a) ?? 0, cash = cashOf(a) ?? 0;
  const done: string[] = [], warnings: string[] = [];
  if (!count && !cash) return { done, warnings };
  if (!(await canBill(ctx))) {
    return { done, warnings: ['Prepaid appointments and cash collected are saved on the survey, but not in Client Billing yet — that takes Client Billing access. Someone with it can open this survey and save it again.'] };
  }
  const some = `${count} prepaid appointment${count === 1 ? '' : 's'}`;

  if (cash > 0) {
    const { error } = await service.from('billing_charges').insert({
      client_id: clientId, client_name: clientName,
      kind: 'custom', description: `Onboarding — cash collected${count ? ` (${some})` : ''}`, appointment_count: 0,
      subtotal: cash, credit_applied: 0, total: cash,
      method: 'manual', status: 'paid', paid_at: now(),
      request_id: `survey-cash:${clientId}`, created_by: ctx.userId,
    });
    if (!error) done.push(`${usd(cash)} collected recorded as a payment in Client Billing`);
    else if (error.code !== '23505') warnings.push('The cash collected could not be recorded in Client Billing');
  }

  if (count > 0) {
    const { data: before, error: readErr } = await service.from('billing_credits').select('id').eq('client_id', clientId).like('reason', `${SURVEY_CREDIT}%`).limit(1);
    if (readErr) warnings.push('The prepaid credits could not be issued in Client Billing');
    else if (!before?.length) {
      let price = surveyPrice ?? 0;
      if (price <= 0) {
        const { data: s } = await service.from('billing_clients').select('price_per_appointment').eq('client_id', clientId).maybeSingle();
        price = Number((s as { price_per_appointment?: number | null } | null)?.price_per_appointment ?? 0) || 0;
      }
      if (price <= 0) warnings.push(`The ${some} were not issued as credits: there is no price per appointment. Set it in Client Billing and use Issue credits there.`);
      else {
        const { error } = await service.from('billing_credits').insert({
          client_id: clientId, amount: round2((toCents(price) * count) / 100),
          reason: `${SURVEY_CREDIT} — ${some}`, created_by: ctx.userId,
        });
        if (error) warnings.push('The prepaid credits could not be issued in Client Billing');
        else done.push(`${some} issued as credits — their next ${count === 1 ? 'booking is' : `${count} bookings are`} not billed`);
      }
    }
  }
  return { done, warnings };
}

/**
 * Submit the survey.
 *   { answers }                 a new client: roster, profile, billing, card(s)
 *   { answers, card_id }        filled in from a card added by name — that card is used
 *   { answers, client_id }      correcting a client's answers — no new cards
 */
export async function submitSurvey(ctx: AuthContext, body: Record<string, unknown>): Promise<Outcome> {
  const { service } = ctx;
  const a = cleanAnswers(body.answers);
  const problem = surveyProblem(a);
  if (problem) return fail(problem);
  const name = str(a, 'business_name');
  const wanted = serviceOf(a);

  const probe = await service.from('client_surveys').select('client_id').limit(1);
  if (probe.error) return tablesMissing(probe.error) ? fail(NEEDS_SETUP, 503) : fail(probe.error.message ?? 'Could not reach the database', 500);

  let fromCard: Card | null = null;
  if (typeof body.card_id === 'string' && body.card_id) {
    const { data } = await service.from('onboarding_cards').select('*').eq('id', body.card_id).maybeSingle();
    fromCard = (data as Card | null) ?? null;
    if (!fromCard) return fail('Card not found', 404);
  }
  const editing = typeof body.client_id === 'string' && body.client_id ? body.client_id : null;

  // 1. Client Roster
  const roster = await ensureRosterFor(service, { name, clientId: editing ?? fromCard?.client_id, wanted });
  if (roster.error || !roster.client_id) return fail(roster.error ?? 'Could not add the client to the roster', 500);
  const clientId = roster.client_id;
  const { data: rosterRow } = await service.from('clients').select('id, name, status, service').eq('id', clientId).maybeSingle();

  // 2. The answers themselves
  const { data: before } = await service.from('client_surveys').select('client_id').eq('client_id', clientId).maybeSingle();
  const by = await whoIs(ctx);
  const { error: saveErr } = await service.from('client_surveys').upsert({
    client_id: clientId, answers: a, submitted_by: ctx.userId, submitted_by_name: by, updated_at: now(),
  }, { onConflict: 'client_id' });
  if (saveErr) return fail(saveErr.message ?? 'Could not save the survey', 500);

  const warnings: string[] = [];

  // 3. The shared client profile
  const profileProblem = await writeProfiles(ctx, clientId, String(rosterRow?.name ?? name), a);
  if (profileProblem) warnings.push(profileProblem);

  // 4. Client Billing: the price, and the customer record in Stripe
  const price = priceOf(a);
  if (price !== null) {
    const { error } = await service.from('billing_clients')
      .upsert({ client_id: clientId, price_per_appointment: price, updated_at: now() }, { onConflict: 'client_id' });
    if (error) warnings.push('The price per appointment could not be saved to Client Billing');
  }
  // 4b. What they paid on signing: credits for the prepaid appointments, and the cash.
  const done: string[] = [];
  const prepaid = await applyPrepaid(ctx, clientId, String(rosterRow?.name ?? name), a, price);
  done.push(...prepaid.done); warnings.push(...prepaid.warnings);

  const stripe: Row = { configured: stripeStatus().configured };
  if (stripe.configured) {
    const customer = await ensureStripeCustomer(service, clientId, String(rosterRow?.name ?? name), billingEmail(a) || null);
    if (customer.error) { stripe.error = customer.error; warnings.push(`Stripe: ${customer.error}`); }
    else stripe.made = customer.made;
  }

  // 5. The Onboarding board: one card per service. A checklist that already
  //    has a card under way keeps that card; correcting a survey opens none.
  const cards: Card[] = [];
  const contact = { contact_name: contactName(a) || null, contact_email: billingEmail(a) || null, contact_phone: mainPhone(a) || null };
  if (!editing) {
    const tracks = tracksOf(a);
    const templates = await readTemplates(service);
    for (const track of tracks) {
      // A card added by name takes the first checklist it does not clash with.
      if (fromCard && (!fromCard.track || fromCard.track === track)) {
        const items = await coveredSteps(service, snapshot(templates[track], fromCard.items), 'survey', clientId, by);
        const { data, error } = await service.from('onboarding_cards').update({
          client_id: clientId, track, items, ...contact, updated_at: now(),
          ...(fromCard.stage === 'not_started' ? { stage: 'in_progress' } : {}),
        }).eq('id', fromCard.id).select('*').single();
        if (error) warnings.push('The card could not be updated');
        else cards.push(data as Card);
        fromCard = null;
        continue;
      }
      const made = await createCard(service, { client_name: name, track, client_id: clientId, source: 'survey', created_by: ctx.userId, by, ...contact });
      if (made.error || !made.card) { warnings.push(`The ${track === 'sms' ? 'SMS' : 'Facebook Ads'} card could not be opened`); continue; }
      // The survey is the first tick, so the card is under way.
      if (!made.existing && made.card.stage === 'not_started') {
        const { data } = await service.from('onboarding_cards').update({ stage: 'in_progress', updated_at: now() }).eq('id', made.card.id).select('*').single();
        cards.push((data as Card | null) ?? made.card);
      } else cards.push(made.card);
    }
  }

  // 6. GoHighLevel: a client who filled in the survey has signed, so their
  //    contact in the Tomsi Media account is marked closed. Not on a correction.
  let ghl: Row = { marked: false, why: 'editing' };
  if (!editing) {
    const count = prepaidOf(a) ?? 0, cash = cashOf(a) ?? 0;
    const note = [`Signed — new client survey filled in by ${by}.`, cash ? `Cash collected: ${usd(cash)}.` : '', count ? `Prepaid appointments: ${count}.` : ''].filter(Boolean).join(' ');
    const result = await markClosedInGhl({
      emails: [str(a, 'business_email'), str(a, 'personal_email')],
      phones: [str(a, 'business_phone'), str(a, 'personal_phone')],
      note,
    });
    ghl = result;
    if (result.marked) done.push('Marked as closed in GoHighLevel (Post-Call Status: Close)');
    else if (result.why === 'not_found') warnings.push("GoHighLevel: no contact with that email or phone, so they were not marked as closed — set Post-Call Status to Close by hand");
    else if (result.why === 'no_contact_details') warnings.push('GoHighLevel: the survey has no email or phone, so they were not marked as closed');
    else if (result.why === 'failed') warnings.push('GoHighLevel would not take the update — set Post-Call Status to Close by hand');
  }

  return {
    status: 200,
    json: {
      client: { id: clientId, name: rosterRow?.name ?? name, status: rosterRow?.status ?? null, service: rosterRow?.service ?? wanted, created: !!roster.created },
      cards, stripe, warnings, updated: !!before, done, ghl,
    },
  };
}
