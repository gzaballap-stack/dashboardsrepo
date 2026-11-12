import { NextResponse } from 'next/server';
import type { AuthContext } from '@/lib/api-auth';
import { cleanTemplate, isStage, isTrack, parseAdAccount, snapshot, steps, type Card, type CardItem } from './onboarding';
import { coveredSteps, createCard, ensureRoster, fillFromRoster, lookupAdAccount, readTemplates, tablesMissing } from './onboarding-server';
import { cardLink, ensureStripeCustomer, readSurvey, submitSurvey, whoIs, type Outcome } from './client-survey-server';
import { getCustomer, stripeStatus } from './stripe';

// Onboarding board (Clients > Onboarding) — what /api/onboarding does, once the
// caller is known. Rules in onboarding.ts, database helpers in onboarding-server.ts.
//
//   GET                                    every card + the two checklists
//   POST { action: 'create', client_name, track? }
//        { action: 'update', id, client_name?, notes?, track? }   picking a track loads its checklist
//        { action: 'move',   id, stage, position }                 drag between / inside columns
//        { action: 'item',   id, item_id, done?, value? }          tick a step or fill one in
//        { action: 'refresh', id }                                 re-read the checklist from the template
//        { action: 'delete', id }
//        { action: 'template', track, items | null }               admins; null = back to the built-in list
//        { action: 'survey_submit', answers, card_id? | client_id? }  the new client survey (client-survey-server.ts)
//        { action: 'survey_get', client_id }                        a client's answers
//        { action: 'card_link', id }                                Stripe's page for putting the card on file
//
// Tables onboarding_cards + onboarding_templates (migrations/add_onboarding.sql).
// Without them the GET answers { ready: false } and the page says what to run.

type Service = AuthContext['service'];

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const NEEDS_SETUP = { ready: false, error: 'Onboarding needs a one-off database update first (node scripts/migrate-onboarding.mjs v1)' };

async function isAdmin(ctx: AuthContext): Promise<boolean> {
  const { data } = await ctx.service.from('profiles').select('is_admin').eq('id', ctx.userId).maybeSingle();
  return data?.is_admin === true;
}

const send = (o: Outcome) => NextResponse.json(o.json, { status: o.status });

async function readCard(service: Service, id: unknown): Promise<Card | null> {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await service.from('onboarding_cards').select('*').eq('id', id).maybeSingle();
  return (data as Card | null) ?? null;
}

async function save(service: Service, id: string, patch: Record<string, unknown>) {
  const { data, error } = await service.from('onboarding_cards')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ card: data });
}

export async function onboardingGet(ctx: AuthContext) {
  const { data, error } = await ctx.service.from('onboarding_cards').select('*').order('position');
  if (error) return tablesMissing(error) ? NextResponse.json(NEEDS_SETUP) : bad(error.message, 500);

  const [templates, admin] = await Promise.all([readTemplates(ctx.service), isAdmin(ctx)]);
  return NextResponse.json({ ready: true, cards: data ?? [], templates, is_admin: admin });
}

export async function onboardingPost(ctx: AuthContext, body: Record<string, unknown>, origin = '') {
  const { service } = ctx;
  const action = body.action;

  if (action === 'survey_submit') return send(await submitSurvey(ctx, body));
  if (action === 'survey_get') {
    if (typeof body.client_id !== 'string' || !body.client_id) return bad('client_id is required');
    return send(await readSurvey(service, body.client_id));
  }

  if (action === 'create') {
    const made = await createCard(service, {
      client_name: String(body.client_name ?? ''), track: isTrack(body.track) ? body.track : null, created_by: ctx.userId,
    });
    if (made.error) return tablesMissing({ message: made.error }) ? bad(NEEDS_SETUP.error, 503) : bad(made.error);
    return NextResponse.json({ card: made.card, existing: !!made.existing });
  }

  if (action === 'template') {
    if (!(await isAdmin(ctx))) return bad('Only an admin can change the checklists', 403);
    if (!isTrack(body.track)) return bad('track must be facebook or sms');
    if (body.items === null) {
      const { error } = await service.from('onboarding_templates').delete().eq('track', body.track);
      if (error) return bad(error.message, 500);
    } else {
      const items = cleanTemplate(body.items);
      if (!items) return bad('The checklist needs at least one step');
      const { error } = await service.from('onboarding_templates')
        .upsert({ track: body.track, items, updated_at: new Date().toISOString() });
      if (error) return bad(error.message, 500);
    }
    return NextResponse.json({ templates: await readTemplates(service) });
  }

  const card = await readCard(service, body.id);
  if (!card) return bad('Card not found', 404);

  if (action === 'card_link') return send(await cardLink(service, card, origin));

  if (action === 'delete') {
    const { error } = await service.from('onboarding_cards').delete().eq('id', card.id);
    if (error) return bad(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  if (action === 'move') {
    if (!isStage(body.stage)) return bad('stage must be not_started, in_progress or done');
    const position = Number(body.position);
    return save(service, card.id, {
      stage: body.stage,
      ...(Number.isFinite(position) ? { position } : {}),
      completed_at: body.stage === 'done' ? (card.completed_at ?? new Date().toISOString()) : null,
    });
  }

  if (action === 'update') {
    const patch: Record<string, unknown> = {};
    if (typeof body.client_name === 'string') {
      const name = body.client_name.trim().slice(0, 200);
      if (!name) return bad('A client name is needed');
      patch.client_name = name;
    }
    if ('notes' in body) patch.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.slice(0, 5000) : null;
    if ('track' in body) {
      if (!isTrack(body.track)) return bad('track must be facebook or sms');
      // Switching service keeps anything already ticked on steps both lists share.
      const items = snapshot((await readTemplates(service))[body.track], card.items);
      patch.track = body.track;
      patch.items = await coveredSteps(service, items, card.source, card.client_id);
    }
    return save(service, card.id, patch);
  }

  if (action === 'refresh') {
    if (!card.track) return bad('Pick Facebook Ads or SMS first');
    const items = snapshot((await readTemplates(service))[card.track], card.items);
    return save(service, card.id, { items: await fillFromRoster(service, card.client_id, items) });
  }

  if (action === 'item') {
    const item = card.items.find(i => i.id === body.item_id);
    if (!item || item.kind === 'heading') return bad('Step not found', 404);

    const stamp = { by: await whoIs(ctx), at: new Date().toISOString() };
    const cleared = { done: false, by: undefined, at: undefined };
    const patch: Record<string, unknown> = {};
    let next: CardItem = item;
    let message: string | undefined;

    if (item.auto === 'roster') {
      // Ticking it does the work. Unticking only clears the tick — the roster
      // record stays (other pages may already be using it).
      if (body.done === false) next = { ...item, ...cleared, note: undefined };
      else {
        const r = await ensureRoster(service, card);
        if (r.error || !r.client_id) return bad(r.error ?? 'Could not add the client to the roster', 500);
        patch.client_id = r.client_id;
        next = { ...item, done: true, note: r.created ? 'Added to the roster in Setup' : 'Already on the roster — linked', ...stamp };
      }
    } else if (item.auto === 'card') {
      // Ticks only when Stripe really holds a card for the client.
      if (body.done === false) next = { ...item, ...cleared, note: undefined };
      else {
        if (!stripeStatus().configured) return bad('Stripe is not connected here, so the card cannot be checked', 503);
        const r = await ensureRoster(service, card);
        if (r.error || !r.client_id) return bad(r.error ?? 'Could not add the client to the roster', 500);
        patch.client_id = r.client_id;
        const customer = await ensureStripeCustomer(service, r.client_id, card.client_name, card.contact_email);
        if (customer.error || !customer.id) return bad(customer.error ?? 'Could not reach Stripe', 502);
        let payment: { label: string } | null = null;
        try { payment = (await getCustomer(customer.id))?.payment ?? null; }
        catch (e) { return bad(e instanceof Error ? e.message : "Couldn't reach Stripe", 502); }
        if (!payment) return bad('No card on file in Stripe yet — get the card link and have it filled in first.');
        next = { ...item, done: true, note: `${payment.label} — ready to charge from Client Billing`, ...stamp };
      }
    } else if (item.auto === 'ad_account') {
      const raw = String(body.value ?? '').trim();
      if (!raw) next = { ...item, ...cleared, value: undefined, note: undefined };
      else {
        const account = parseAdAccount(raw);
        if (!account) return bad('That does not look like an ad account — paste the ID (act_…) or the Ads Manager link');
        const seen = await lookupAdAccount(account);
        if (seen && !seen.ok) {
          // No access yet is the usual reason; anything else, pass Meta's own words on.
          const noAccess = /permission|grant|access|does not exist/i.test(seen.error ?? '');
          return bad(noAccess
            ? `We can't see ${account} on Facebook yet — check the number, and that Facebook access has come through.`
            : `Facebook would not confirm ${account}: ${seen.error}`);
        }
        // The account lives on the roster record; that is what the spend sync reads.
        const r = await ensureRoster(service, card);
        if (r.error || !r.client_id) return bad(r.error ?? 'Could not add the client to the roster', 500);
        const { error } = await service.from('clients').update({ meta_account_id: account }).eq('id', r.client_id);
        if (error) return bad(error.message, 500);
        patch.client_id = r.client_id;
        next = { ...item, done: true, value: account, note: `${seen?.name ? `${seen.name} — ` : ''}ad spend now syncs on its own`, ...stamp };
        message = r.created ? 'Client added to the roster in Setup' : undefined;
      }
    } else if (item.kind === 'text') {
      const value = String(body.value ?? '').trim().slice(0, 2000);
      next = value ? { ...item, value, done: true, ...stamp } : { ...item, ...cleared, value: undefined };
    } else {
      next = body.done ? { ...item, done: true, ...stamp } : { ...item, ...cleared };
    }

    let items = card.items.map(i => i.id === item.id ? next : i);
    // Saving the ad account put the client on the roster — tick that step too.
    if (patch.client_id) items = items.map(i => i.auto === 'roster' && !i.done ? { ...i, done: true, note: 'On the roster', ...stamp } : i);
    patch.items = patch.client_id ? await fillFromRoster(service, patch.client_id as string, items) : items;
    // The first tick is what starts an onboarding.
    if (card.stage === 'not_started' && steps(patch.items as CardItem[]).some(i => i.done)) patch.stage = 'in_progress';

    const res = await save(service, card.id, patch);
    if (!message || !res.ok) return res;
    return NextResponse.json({ ...(await res.json()), message });
  }

  return bad('Unknown action');
}
