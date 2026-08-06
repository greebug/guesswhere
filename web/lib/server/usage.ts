import { createHash } from 'node:crypto';
import {
  bumpUsage,
  readUsage,
  readUsageHistory,
  recordRateEvent,
  countRateEvents,
  isAccountExempt,
} from '@/lib/server/gameDb';

/**
 * Mapbox map-load metering, a spend ceiling, and per-player rate limiting.
 *
 * Why this exists: Mapbox bills per map load on a marginal scale -- 50,000 free
 * a month, then $5/1,000 for the next 50,000, $4 for the next 100,000, $3
 * beyond that. 100,000 loads is $250; a million is about $3,050. They offer
 * usage alerts but no hard spend cap, so a link that catches on somewhere
 * busy bills whatever it bills. The only ceiling that actually exists is one
 * imposed here, on the side that issues games.
 *
 * The game costs exactly ONE map load per play-screen mount, not one per
 * round: MainMap builds a single mapboxgl.Map in a []-dependency effect and
 * repositions it with jumpTo between rounds. So loads track "how many times
 * somebody opened a game", including refreshes and rejoins.
 */

export const MAP_LOAD_METRIC = 'mapbox_map_loads';

/** Default sits under Mapbox's 50,000 free tier rather than on it. The gap is
 * deliberate slack: our count and theirs will never agree exactly (a load that
 * fails before the `load` event fires is billed by them and missed by us), and
 * the whole point is to stop short of the first billed load rather than to
 * discover the drift by being invoiced for it. */
const DEFAULT_MONTHLY_BUDGET = 45_000;

/** Per player, per rolling day. Generous for a real session -- ten games is a
 * long evening -- and low enough that a script can't run up four figures
 * overnight before anyone notices. */
const DEFAULT_GAMES_PER_DAY = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A single game session can only ever contribute this many loads to the
 * meter. A genuine player refreshes a handful of times; this bounds what a
 * forged client can add, so the kill switch can't be tripped on purpose by
 * hammering the reporting endpoint with one game id. */
export const MAX_LOADS_PER_SESSION = 40;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function monthlyBudget(): number {
  return intFromEnv('MAPBOX_MONTHLY_LOAD_BUDGET', DEFAULT_MONTHLY_BUDGET);
}

export function gamesPerDayLimit(): number {
  return intFromEnv('GAMES_PER_DAY_LIMIT', DEFAULT_GAMES_PER_DAY);
}

/** UTC, to match how Mapbox reports a billing month. A local-time period would
 * drift against the invoice by up to a day at each end. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function recordMapLoad(count = 1): void {
  bumpUsage(MAP_LOAD_METRIC, currentPeriod(), count);
}

export function mapLoadsThisMonth(): number {
  return readUsage(MAP_LOAD_METRIC, currentPeriod());
}

export function mapLoadHistory(limit = 12) {
  return readUsageHistory(MAP_LOAD_METRIC, limit);
}

/**
 * Two levels, deliberately not the same thing.
 *
 * USAGE_EXEMPT_USERS (env) is the ROOT: those accounts bypass the limits AND
 * are the only ones who may grant the bypass to anyone else. It lives in the
 * environment because that is the one place a person with database access but
 * not deploy access cannot quietly add themselves to.
 *
 * users.usage_exempt (database) is the grantable version, so adding a friend
 * doesn't need a redeploy. A granted account skips the limits and nothing more
 * -- it cannot grant onward, so the whitelist can never grow on its own.
 */
function rootUsers(): Set<string> {
  return new Set(
    (process.env.USAGE_EXEMPT_USERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Root only: may view the roster and grant/revoke exemption. */
export function isAdmin(username: string | null | undefined): boolean {
  if (!username) return false;
  return rootUsers().has(username.toLowerCase());
}

/** Root or granted: bypasses the budget and the daily limit. */
export function isExempt(username: string | null | undefined): boolean {
  if (!username) return false;
  if (rootUsers().has(username.toLowerCase())) return true;
  return isAccountExempt(username);
}

export interface BudgetState {
  used: number;
  budget: number;
  remaining: number;
  overBudget: boolean;
}

export function budgetState(): BudgetState {
  const used = mapLoadsThisMonth();
  const budget = monthlyBudget();
  return { used, budget, remaining: Math.max(0, budget - used), overBudget: used >= budget };
}

/** Stable, non-reversible actor key. A signed-in player is keyed by account so
 * the limit follows them across devices; everyone else by a hash of their IP,
 * truncated -- enough to count against, and not a stored address. */
export function actorKey(userId: string | null, ip: string | null): string {
  if (userId) return `u:${userId}`;
  const salt = process.env.RATE_LIMIT_SALT ?? 'guesswhere';
  return `ip:${createHash('sha256').update(`${salt}:${ip ?? 'unknown'}`).digest('hex').slice(0, 16)}`;
}

/** Railway terminates TLS upstream, so the socket address is a proxy. The
 * left-most x-forwarded-for entry is the client as reported by the first proxy
 * we control; it is spoofable by design, which is why this only ever feeds a
 * rate limit and never an auth decision. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return headers.get('x-real-ip');
}

export interface RateState {
  used: number;
  limit: number;
  limited: boolean;
}

export function gameRateState(actor: string, now = Date.now()): RateState {
  const limit = gamesPerDayLimit();
  const used = countRateEvents(actor, 'game', now - DAY_MS);
  return { used, limit, limited: used >= limit };
}

export function recordGameStart(actor: string, now = Date.now()): void {
  recordRateEvent(actor, 'game', now);
}
