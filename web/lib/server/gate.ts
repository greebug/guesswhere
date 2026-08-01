import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server/auth';
import {
  actorKey,
  budgetState,
  clientIp,
  gameRateState,
  isExempt,
  recordGameStart,
} from '@/lib/server/usage';

/**
 * The one place that decides whether a new game may start.
 *
 * Both checks live here rather than in each route so the answer can't drift
 * between solo games and duels -- a duel opens the same Mapbox map and costs
 * the same load, so exempting it would leave the ceiling with a hole in it.
 */

export interface GateResult {
  /** Non-null means refuse and return this. */
  response: NextResponse | null;
  /** Call once the game has actually been created, so a request that fails
   * validation afterwards doesn't consume the player's daily allowance. */
  commit: () => void;
}

const ALLOW: GateResult = { response: null, commit: () => {} };

export async function gateNewGame(headers: Headers): Promise<GateResult> {
  const user = await getCurrentUser();

  // Exempt accounts skip both checks and are not metered against the day's
  // allowance -- see usage.ts for why this exists at all.
  if (isExempt(user?.username)) return ALLOW;

  const budget = budgetState();
  if (budget.overBudget) {
    return {
      // 503, not 429: this is the service declining to spend money, not the
      // caller misbehaving. Retry-After points at the start of next month,
      // which is when the counter actually rolls over.
      response: NextResponse.json(
        {
          error:
            "Guesswhere has hit its imagery budget for this month. The map data isn't free and the ceiling is there so it stays affordable — new games open again on the 1st.",
          reason: 'budget',
        },
        { status: 503, headers: { 'Retry-After': String(secondsUntilNextMonth()) } }
      ),
      commit: () => {},
    };
  }

  const actor = actorKey(user?.id ?? null, clientIp(headers));
  const rate = gameRateState(actor);
  if (rate.limited) {
    return {
      response: NextResponse.json(
        {
          error: `That's ${rate.limit} games in a day — the limit exists to keep the imagery bill survivable. Try again tomorrow.`,
          reason: 'rate',
        },
        { status: 429, headers: { 'Retry-After': String(60 * 60) } }
      ),
      commit: () => {},
    };
  }

  return { response: null, commit: () => recordGameStart(actor) };
}

function secondsUntilNextMonth(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000));
}
