// Whoop — server side only. OAuth, token refresh, and turning Whoop's API
// records into one row per day.
//
// Whoop's unit of time is the *cycle*: it starts when you wake and ends when
// you next wake, and recovery and last night's sleep both hang off it. So a
// "day" here is the morning you got up, in your own timezone, and the night
// before belongs to it. Everything is joined on cycle id, not on the clock.
//
// Tokens: access tokens last about an hour; refresh tokens rotate on every use
// and the old one dies, so a refresh is written to the database the moment it
// comes back. Two refreshes at once would kill each other — the sync lock in
// `whoop_connections.sync_started_at` exists for that.

import type { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API = 'https://api.prod.whoop.com/developer';

export const WHOOP_SCOPES = [
  'read:recovery', 'read:cycles', 'read:sleep', 'read:workout',
  'read:profile', 'read:body_measurement', 'offline',
];

export function whoopConfigured() {
  return !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);
}

function creds() {
  const id = process.env.WHOOP_CLIENT_ID;
  const secret = process.env.WHOOP_CLIENT_SECRET;
  if (!id || !secret) throw new WhoopError('Whoop is not configured on this server', 'config');
  return { id, secret };
}

export type WhoopErrorKind = 'config' | 'auth' | 'reconnect' | 'api' | 'busy';

export class WhoopError extends Error {
  kind: WhoopErrorKind;
  constructor(message: string, kind: WhoopErrorKind) {
    super(message);
    this.kind = kind;
  }
}

// The address Whoop sends the browser back to. Behind Railway the request URL
// is the internal one, so the public host comes from the forwarded headers.
export function redirectUri(req: Request) {
  if (process.env.WHOOP_REDIRECT_URI) return process.env.WHOOP_REDIRECT_URI;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  return `${proto}://${host}/api/whoop/callback`;
}

export function authorizeUrl(req: Request, state: string) {
  const { id } = creds();
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', redirectUri(req));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', WHOOP_SCOPES.join(' '));
  u.searchParams.set('state', state);
  return u.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    // invalid_grant on a refresh means the refresh token is dead — the user has
    // to go through the connect flow again. Anything else is transient.
    const dead = res.status === 400 || res.status === 401;
    throw new WhoopError(
      dead ? 'Whoop needs reconnecting' : `Whoop token request failed (${res.status})`,
      dead ? 'reconnect' : 'api',
    );
  }
  return JSON.parse(text);
}

export async function exchangeCode(req: Request, code: string) {
  const { id, secret } = creds();
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(req),
  });
}

async function refreshToken(refresh: string) {
  const { id, secret } = creds();
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: id,
    client_secret: secret,
    scope: 'offline',
  });
}

export function expiresAt(expiresIn: number) {
  return new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
}

export type Connection = {
  user_id: string;
  whoop_user_id: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_synced_at: string | null;
  sync_started_at: string | null;
  last_error: string | null;
};

// A usable access token, refreshed and saved if it is about to expire.
async function freshToken(service: Service, conn: Connection): Promise<string> {
  const soon = Date.now() + 120_000;
  if (new Date(conn.expires_at).getTime() > soon) return conn.access_token;

  let t: TokenResponse;
  try {
    t = await refreshToken(conn.refresh_token);
  } catch (e) {
    if (e instanceof WhoopError && e.kind === 'reconnect') {
      await service.from('whoop_connections')
        .update({ last_error: 'Connection expired — reconnect Whoop', updated_at: new Date().toISOString() })
        .eq('user_id', conn.user_id);
    }
    throw e;
  }
  await service.from('whoop_connections').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: expiresAt(t.expires_in),
    updated_at: new Date().toISOString(),
  }).eq('user_id', conn.user_id);
  return t.access_token;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function api<T>(token: string, path: string, params?: Record<string, string>): Promise<T> {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new WhoopError('Whoop rejected the token', 'reconnect');
    // The limit is 100 calls a minute. A long backfill can brush it; waiting
    // out the window and carrying on beats failing the whole pull.
    if (res.status === 429 && attempt < 3) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      await sleep(Number.isFinite(reset) && reset > 0 ? Math.min(reset, 70) * 1000 : 30_000);
      continue;
    }
    if (res.status === 429) throw new WhoopError('Whoop rate limit hit — try again in a minute', 'api');
    if (!res.ok) throw new WhoopError(`Whoop API ${res.status} on ${path}`, 'api');
    return res.json();
  }
}

// Every page of a collection endpoint between two instants.
async function collect<T>(token: string, path: string, start: Date, end: Date): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined;
  for (let page = 0; page < 40; page++) {
    const params: Record<string, string> = { limit: '25', start: start.toISOString(), end: end.toISOString() };
    if (next) params.nextToken = next;
    const d = await api<{ records?: T[]; next_token?: string | null }>(token, path, params);
    out.push(...(d.records ?? []));
    if (!d.next_token) break;
    next = d.next_token;
  }
  return out;
}

/* ── Whoop record shapes (the fields read here) ─────────────────────────── */

type Cycle = {
  id: number | string; start: string; end?: string | null; timezone_offset?: string;
  score_state?: string;
  score?: { strain?: number; kilojoule?: number; average_heart_rate?: number; max_heart_rate?: number } | null;
  step_count?: number;
};
type Recovery = {
  cycle_id: number | string; score_state?: string;
  score?: {
    recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number;
    spo2_percentage?: number; skin_temp_celsius?: number; user_calibrating?: boolean;
  } | null;
};
type Sleep = {
  id: string; cycle_id?: number | string | null; nap?: boolean; start: string; end?: string; timezone_offset?: string;
  score_state?: string;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli?: number; total_awake_time_milli?: number;
      total_light_sleep_time_milli?: number; total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
      sleep_cycle_count?: number; disturbance_count?: number;
    };
    sleep_performance_percentage?: number; sleep_efficiency_percentage?: number;
    sleep_consistency_percentage?: number; respiratory_rate?: number;
    // Whoop's sleep need for the night: a baseline plus what recent strain and
    // carried-over debt add, minus what a nap took off (that one is negative).
    sleep_needed?: {
      baseline_milli?: number; need_from_sleep_debt_milli?: number;
      need_from_recent_strain_milli?: number; need_from_recent_nap_milli?: number;
    };
  } | null;
};
type Workout = {
  id: string; start: string; end?: string; timezone_offset?: string; sport_name?: string;
  score_state?: string;
  score?: {
    strain?: number; average_heart_rate?: number; max_heart_rate?: number; kilojoule?: number;
    percent_recorded?: number; distance_meter?: number; altitude_gain_meter?: number; altitude_change_meter?: number;
    zone_durations?: {
      zone_zero_milli?: number; zone_one_milli?: number; zone_two_milli?: number;
      zone_three_milli?: number; zone_four_milli?: number; zone_five_milli?: number;
    };
  } | null;
};

// "2026-10-13T05:12:00.000Z" + "+02:00" → "2026-10-13" in that zone.
export function localDay(isoInstant: string, offset?: string | null): string {
  const t = new Date(isoInstant).getTime();
  const m = /^([+-])(\d{2}):(\d{2})/.exec(offset ?? '');
  const mins = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(t + mins * 60_000).toISOString().slice(0, 10);
}

// The same instant as a wall-clock time in that zone: "06:40".
export function localClock(isoInstant: string, offset?: string | null): string {
  const t = new Date(isoInstant).getTime();
  const m = /^([+-])(\d{2}):(\d{2})/.exec(offset ?? '');
  const mins = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(t + mins * 60_000).toISOString().slice(11, 16);
}

const minutes = (milli?: number) => (typeof milli === 'number' ? Math.round(milli / 60_000) : null);
const hours = (milli?: number) => (typeof milli === 'number' ? Math.round((milli / 3_600_000) * 100) / 100 : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export type WorkoutRow = {
  sport: string; strain: number | null; minutes: number | null; start: string;
  avg_hr: number | null; max_hr: number | null;
  kcal: number | null; distance_m: number | null; altitude_gain_m: number | null;
  percent_recorded: number | null;
  // Minutes in each heart-rate zone, 0 (rest) to 5 (max).
  zones: (number | null)[] | null;
};

export type DayRow = {
  user_id: string; day: string; cycle_id: string | null;
  recovery_score: number | null; hrv_ms: number | null; resting_hr: number | null;
  spo2: number | null; skin_temp_c: number | null;
  sleep_hours: number | null; nap_hours: number | null;
  sleep_performance: number | null; sleep_efficiency: number | null; sleep_consistency: number | null;
  respiratory_rate: number | null;
  sleep_need_hours: number | null; sleep_debt_hours: number | null;
  steps: number | null;
  bed_time_local: string | null; wake_time_local: string | null;
  sleep_cycles: number | null; disturbances: number | null;
  sleep_stages: { light: number | null; deep: number | null; rem: number | null; awake: number | null } | null;
  strain: number | null; kilojoules: number | null; avg_hr: number | null; max_hr: number | null;
  workouts: WorkoutRow[];
  scored: boolean;
  synced_at: string;
};

// Cycles are the spine; recovery, sleep and workouts attach to them. Pure, so
// it can be checked against fixtures without a Whoop account.
export function assembleDays(userId: string, cycles: Cycle[], recoveries: Recovery[], sleeps: Sleep[], workouts: Workout[]): DayRow[] {
  const recByCycle = new Map<string, Recovery>();
  for (const r of recoveries) recByCycle.set(String(r.cycle_id), r);

  const sleepByCycle = new Map<string, Sleep[]>();
  for (const s of sleeps) {
    const k = s.cycle_id == null ? '' : String(s.cycle_id);
    if (!k) continue;
    sleepByCycle.set(k, [...(sleepByCycle.get(k) ?? []), s]);
  }

  const workoutsByDay = new Map<string, Workout[]>();
  for (const w of workouts) {
    const k = localDay(w.start, w.timezone_offset);
    workoutsByDay.set(k, [...(workoutsByDay.get(k) ?? []), w]);
  }

  const now = new Date().toISOString();
  const rows = new Map<string, DayRow>();

  for (const c of cycles) {
    const day = localDay(c.start, c.timezone_offset);
    const cid = String(c.id);
    const rec = recByCycle.get(cid);
    const cycleSleeps = sleepByCycle.get(cid) ?? [];
    const main = cycleSleeps.find(s => !s.nap) ?? null;
    const naps = cycleSleeps.filter(s => s.nap);

    const stages = main?.score?.stage_summary;
    const inBed = stages?.total_in_bed_time_milli;
    const awake = stages?.total_awake_time_milli;
    const asleep = typeof inBed === 'number' && typeof awake === 'number' ? inBed - awake : undefined;

    const need = main?.score?.sleep_needed;
    const needMilli = need
      ? (need.baseline_milli ?? 0) + (need.need_from_sleep_debt_milli ?? 0)
        + (need.need_from_recent_strain_milli ?? 0) + (need.need_from_recent_nap_milli ?? 0)
      : undefined;

    const napMilli = naps.reduce((n, s) => {
      const st = s.score?.stage_summary;
      const bed = st?.total_in_bed_time_milli, aw = st?.total_awake_time_milli;
      return n + (typeof bed === 'number' && typeof aw === 'number' ? bed - aw : 0);
    }, 0);

    const dayWorkouts: WorkoutRow[] = (workoutsByDay.get(day) ?? []).map(w => {
      const z = w.score?.zone_durations;
      return {
        sport: w.sport_name ?? 'Workout',
        strain: num(w.score?.strain),
        minutes: w.end ? Math.round((new Date(w.end).getTime() - new Date(w.start).getTime()) / 60_000) : null,
        start: w.start,
        avg_hr: num(w.score?.average_heart_rate),
        max_hr: num(w.score?.max_heart_rate),
        kcal: typeof w.score?.kilojoule === 'number' ? Math.round(w.score.kilojoule / 4.184) : null,
        distance_m: num(w.score?.distance_meter),
        altitude_gain_m: num(w.score?.altitude_gain_meter),
        percent_recorded: num(w.score?.percent_recorded),
        zones: z ? [z.zone_zero_milli, z.zone_one_milli, z.zone_two_milli, z.zone_three_milli, z.zone_four_milli, z.zone_five_milli].map(minutes) : null,
      };
    });

    // Whoop scores a day in stages; "PENDING_SCORE" means come back later. The
    // row is kept so the day shows up, and is rewritten on the next sync.
    const scored = (c.score_state ?? 'SCORED') === 'SCORED'
      && (rec ? (rec.score_state ?? 'SCORED') === 'SCORED' : true);

    rows.set(day, {
      user_id: userId, day, cycle_id: cid,
      recovery_score: num(rec?.score?.recovery_score),
      hrv_ms: num(rec?.score?.hrv_rmssd_milli),
      resting_hr: num(rec?.score?.resting_heart_rate),
      spo2: num(rec?.score?.spo2_percentage),
      skin_temp_c: num(rec?.score?.skin_temp_celsius),
      sleep_hours: hours(asleep),
      nap_hours: napMilli ? hours(napMilli) : null,
      sleep_performance: num(main?.score?.sleep_performance_percentage),
      sleep_efficiency: num(main?.score?.sleep_efficiency_percentage),
      sleep_consistency: num(main?.score?.sleep_consistency_percentage),
      respiratory_rate: num(main?.score?.respiratory_rate),
      sleep_need_hours: hours(needMilli),
      sleep_debt_hours: hours(need?.need_from_sleep_debt_milli),
      steps: num(c.step_count),
      bed_time_local: main ? localClock(main.start, main.timezone_offset ?? c.timezone_offset) : null,
      wake_time_local: main?.end ? localClock(main.end, main.timezone_offset ?? c.timezone_offset) : null,
      sleep_cycles: num(stages?.sleep_cycle_count),
      disturbances: num(stages?.disturbance_count),
      sleep_stages: stages ? {
        light: hours(stages.total_light_sleep_time_milli),
        deep: hours(stages.total_slow_wave_sleep_time_milli),
        rem: hours(stages.total_rem_sleep_time_milli),
        awake: hours(stages.total_awake_time_milli),
      } : null,
      strain: num(c.score?.strain),
      kilojoules: num(c.score?.kilojoule),
      avg_hr: num(c.score?.average_heart_rate),
      max_hr: num(c.score?.max_heart_rate),
      workouts: dayWorkouts,
      scored,
      synced_at: now,
    });
  }

  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export async function fetchProfile(token: string) {
  return api<{ user_id?: number | string; email?: string; first_name?: string; last_name?: string }>(
    token, '/v2/user/profile/basic');
}

// Pull `days` days of history and write them. Returns how many days landed.
//
// Long pulls go in slices of ninety days, newest first, each written as it
// lands — a year is ~60 calls spread over a minute, so the first slices are
// on screen before the last are fetched, and a failure part-way keeps what
// it had. A short slice is a single pass.
export async function syncDays(service: Service, conn: Connection, days: number): Promise<number> {
  const token = await freshToken(service, conn);
  const SLICE = 90;
  let total = 0;

  for (let offset = 0; offset < days; offset += SLICE) {
    const span = Math.min(SLICE, days - offset);
    // The newest slice runs 36h past now: the open cycle has no end yet.
    const end = offset === 0
      ? new Date(Date.now() + 36 * 3_600_000)
      : new Date(Date.now() - offset * 86_400_000);
    const start = new Date(Date.now() - (offset + span + 1) * 86_400_000);

    const [cycles, recoveries, sleeps, workouts] = await Promise.all([
      collect<Cycle>(token, '/v2/cycle', start, end),
      collect<Recovery>(token, '/v2/recovery', start, end),
      collect<Sleep>(token, '/v2/activity/sleep', start, end),
      collect<Workout>(token, '/v2/activity/workout', start, end),
    ]);

    const rows = assembleDays(conn.user_id, cycles, recoveries, sleeps, workouts);
    if (rows.length) {
      const { error } = await service.from('whoop_days').upsert(rows, { onConflict: 'user_id,day' });
      if (error) throw new WhoopError(`Could not save Whoop days: ${error.message}`, 'api');
    }
    total += rows.length;

    // Nothing in a slice means we've gone back past the start of the account.
    if (cycles.length === 0 && offset > 0) break;
    if (offset + SLICE < days) await sleep(4000);
  }
  return total;
}

// The sync with its lock and bookkeeping around it. `days` is how far back to
// look: a long way on first connect, a week on a routine refresh.
export async function runSync(service: Service, userId: string, days: number) {
  const { data: conn } = await service.from('whoop_connections')
    .select('user_id, whoop_user_id, access_token, refresh_token, expires_at, last_synced_at, sync_started_at, last_error')
    .eq('user_id', userId).maybeSingle();
  if (!conn) throw new WhoopError('Whoop is not connected', 'auth');

  // Another sync started in the last two minutes: let it finish. It is the only
  // defence against two refreshes racing for the rotating refresh token.
  if (conn.sync_started_at && Date.now() - new Date(conn.sync_started_at).getTime() < 120_000) {
    throw new WhoopError('A sync is already running', 'busy');
  }

  const now = new Date().toISOString();
  await service.from('whoop_connections').update({ sync_started_at: now }).eq('user_id', userId);

  try {
    const n = await syncDays(service, conn as Connection, days);
    await service.from('whoop_connections').update({
      last_synced_at: new Date().toISOString(), sync_started_at: null, last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    return n;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    await service.from('whoop_connections').update({
      sync_started_at: null, last_error: msg, updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    throw e;
  }
}
