import type { CityRow, Grader } from './grader';
import { insertGameResult } from './gameDb';

const ROUNDS_PER_GAME = 10;
// "Only Coast" mode: 20mi, converted to km. Natural Earth's ocean coastline
// only (etl/add-coastal-distance.js) -- lake shorelines (Great Lakes, etc.)
// don't count, matching the plain-English sense of "coast".
const COAST_THRESHOLD_KM = 20 * 1.609344;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Picks `count` cities with population >= `minPopulation`, no two from the
 * same country (PLAN.md constraint), none from `excludeIds` (report-round
 * blocklist, or cities already used elsewhere in the same game).
 *
 * The population input is a MINIMUM, not a target -- e.g. picking "25,000"
 * means every city is at least that populous, with no upper bound at all
 * (Jakarta is a legal answer for a "25,000" game). An earlier version treated
 * it as the center of a tolerance band, which was wrong on two counts: it
 * silently capped how large a city could appear, and a band wide enough to
 * reliably find 10 distinct countries already spans 100+ of them at most
 * tiers, so a plain shuffle could still hand back a city sitting at the
 * band's low edge -- which is how a ~1,000,000-population city (Colachel)
 * turned up in a "2,000,000" game. That was never desperate widening; it was
 * an ordinary draw from a band that was simply the wrong shape for the
 * question being asked.
 *
 * If the floor is so high that fewer than `count` distinct countries have
 * ANY qualifying city (checked against the real corpus: this only bites
 * above roughly a 15,000,000 floor, where just 9 countries qualify), country
 * repeats are allowed as a last resort rather than silently lowering the
 * floor -- the floor is a promise to the player and takes priority.
 */
function pickCitiesAtOrAbove(
  minPopulation: number,
  pool: CityRow[],
  count: number,
  excludeCountries: Set<string>
): CityRow[] {
  const candidates = shuffle(pool.filter((c) => c.pop_ghsl >= minPopulation));

  const picked: CityRow[] = [];
  const usedCountries = new Set(excludeCountries);
  for (const c of candidates) {
    if (usedCountries.has(c.country)) continue;
    picked.push(c);
    usedCountries.add(c.country);
    if (picked.length === count) return picked;
  }

  // Not enough distinct countries at this floor -- fill remaining slots
  // allowing repeats, still preferring cities not already picked.
  if (picked.length < count) {
    const pickedIds = new Set(picked.map((c) => c.id));
    for (const c of candidates) {
      if (pickedIds.has(c.id)) continue;
      picked.push(c);
      pickedIds.add(c.id);
      if (picked.length === count) break;
    }
  }
  return picked;
}

function applyCoastFilter(pool: CityRow[], onlyCoast: boolean): CityRow[] {
  if (!onlyCoast) return pool;
  return pool.filter(
    (c) => c.dist_to_coast_km !== null && c.dist_to_coast_km <= COAST_THRESHOLD_KM
  );
}

export function selectRound(
  minPopulation: number,
  grader: Grader,
  excludeIds: Set<number> = new Set(),
  onlyCoast: boolean = false
): CityRow[] {
  const pool = applyCoastFilter(
    grader.allCities().filter((c) => !excludeIds.has(c.id)),
    onlyCoast
  );
  const picked = pickCitiesAtOrAbove(minPopulation, pool, ROUNDS_PER_GAME, new Set());
  if (picked.length < ROUNDS_PER_GAME) {
    throw new Error(
      `only found ${picked.length} cities with population >= ${minPopulation}` +
        (onlyCoast ? ' within 20mi of a coast' : '') +
        ' -- corpus may be too small at this floor'
    );
  }
  return picked;
}

/** Single replacement city for the "report round" flow -- see report/route.ts. */
export function pickReplacementCity(
  minPopulation: number,
  grader: Grader,
  excludeIds: Set<number>,
  excludeCountries: Set<string>,
  onlyCoast: boolean = false
): CityRow {
  const pool = applyCoastFilter(
    grader.allCities().filter((c) => !excludeIds.has(c.id)),
    onlyCoast
  );
  const [picked] = pickCitiesAtOrAbove(minPopulation, pool, 1, excludeCountries);
  if (!picked) {
    throw new Error(
      `no replacement city available with population >= ${minPopulation}` +
        (onlyCoast ? ' within 20mi of a coast' : '') +
        ' (excluding reported cities)'
    );
  }
  return picked;
}

export interface RoundState {
  cityId: number;
  lat: number;
  lon: number;
  minRenderZoom: number;
  solved: boolean;
  revealed: boolean;
  canonicalName: string | null; // populated once solved or revealed
  /** Accumulated time this round was the slide on screen -- see accrue(). */
  elapsedMs: number;
}

export interface GameSession {
  id: string;
  targetPopulation: number;
  onlyCoast: boolean;
  createdAt: number;
  rounds: RoundState[];
  /** Owner at creation time; null for a signed-out (guest) game, which is
   * never written to game_results. */
  userId: string | null;
  /** Which slide is on screen, and since when. The pair is the whole timing
   * model: time is only ever credited to the round sitting in these fields. */
  activeRoundIndex: number | null;
  activeSince: number | null;
  usedReveal: boolean;
  usedReport: boolean;
  /** True for a "Share Cities" copy -- a set someone has already played, so
   * never leaderboard-eligible. See the clone route for the reasoning. */
  isClone: boolean;
  finishedAt: number | null;
}

/** Fresh, unsolved copy of another session's exact round set -- same cities,
 * same order, independent progress, and a clean clock. Used for "share these
 * cities" links (a friend gets their own playthrough, not a shared/live
 * session, and races the set from zero rather than inheriting your times). */
export function cloneRoundStates(rounds: RoundState[]): RoundState[] {
  return rounds.map((r) => ({
    cityId: r.cityId,
    lat: r.lat,
    lon: r.lon,
    minRenderZoom: r.minRenderZoom,
    solved: false,
    revealed: false,
    canonicalName: null,
    elapsedMs: 0,
  }));
}

export function createRoundStates(cities: CityRow[]): RoundState[] {
  return cities.map((c) => ({
    cityId: c.id,
    lat: c.lat,
    lon: c.lon,
    minRenderZoom: c.min_render_zoom,
    solved: false,
    revealed: false,
    canonicalName: null,
    elapsedMs: 0,
  }));
}

export function correctCount(session: GameSession): number {
  return session.rounds.filter((r) => r.solved).length;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

// A single accrual step is capped. During normal play the client heartbeats
// every 10s so the cap never binds -- it exists to bound what happens when a
// client stops reporting: a closed tab, a lost connection, or a backgrounded
// tab whose setInterval the browser has throttled to roughly once a minute.
// Without it, closing the tab mid-round and coming back tomorrow would charge
// that round a full day.
const MAX_ACCRUAL_STEP_MS = 30_000;

/**
 * Credits the time since the last checkpoint to whichever round is currently
 * on screen, then re-stamps the checkpoint.
 *
 * A round only accumulates time while it is BOTH the active slide and
 * unsettled, which is what makes the ten per-round times sum to the game's
 * total: exactly one round is ever accruing. It also means revisiting a round
 * you already solved (or revealed) is free -- you're re-reading an answer, not
 * still working on it.
 */
export function accrue(session: GameSession, now: number = Date.now()): void {
  const { activeRoundIndex, activeSince } = session;
  if (activeRoundIndex === null || activeSince === null) return;

  const round = session.rounds[activeRoundIndex];
  if (round && !round.solved && !round.revealed) {
    const step = Math.min(Math.max(0, now - activeSince), MAX_ACCRUAL_STEP_MS);
    round.elapsedMs += step;
  }
  session.activeSince = now;
}

/** Paginate to a round (also serves as the heartbeat -- passing the round
 * that's already active just banks the interval and moves the checkpoint). */
export function setActiveRound(session: GameSession, index: number, now: number = Date.now()): void {
  accrue(session, now);
  session.activeRoundIndex = index;
  session.activeSince = now;
}

export function totalElapsedMs(session: GameSession): number {
  return session.rounds.reduce((sum, r) => sum + r.elapsedMs, 0);
}

/** A game is over once every round is settled one way or the other -- solved
 * or given up on. Reported rounds don't count: reporting swaps in a new city,
 * leaving that slot unsettled again. */
export function isComplete(session: GameSession): boolean {
  return session.rounds.every((r) => r.solved || r.revealed);
}

/** Leaderboard contention requires a clean run: every round solved outright,
 * no reveals, no reported rounds, and an original set rather than a shared
 * one. Population also has to match a preset tier, but that's enforced at
 * query time by which boards exist -- see readLeaderboard(). */
export function isEligible(session: GameSession): boolean {
  return (
    session.rounds.every((r) => r.solved) &&
    !session.usedReveal &&
    !session.usedReport &&
    !session.isClone
  );
}

/** Why a finished game didn't rank, phrased for the end-of-game report.
 * Returns null when it did. */
export function ineligibilityReason(session: GameSession): string | null {
  if (!session.userId) return "You're not signed in";
  if (session.isClone) return 'Shared city sets don’t rank';
  if (session.usedReport) return 'You reported a round';
  if (session.usedReveal) {
    const n = session.rounds.filter((r) => r.revealed).length;
    return `You revealed ${n} round${n === 1 ? '' : 's'}`;
  }
  if (!session.rounds.every((r) => r.solved)) return 'Not every round was solved';
  return null;
}

/** One row of the end-of-game breakdown. Self-contained on purpose -- this is
 * what gets frozen into game_results, so a result page keeps working after
 * the underlying game session has been pruned. */
export interface ResultRound {
  index: number;
  cityId: number;
  name: string;
  country: string;
  lat: number;
  lon: number;
  ms: number;
  solved: boolean;
  revealed: boolean;
}

export function buildResultRounds(session: GameSession, grader: Grader): ResultRound[] {
  return session.rounds.map((r, index) => {
    const city = grader.getCityRow(r.cityId);
    return {
      index,
      cityId: r.cityId,
      name: city?.canonical_name ?? 'Unknown',
      country: city?.country ?? '',
      lat: r.lat,
      lon: r.lon,
      ms: r.elapsedMs,
      solved: r.solved,
      revealed: r.revealed,
    };
  });
}

/**
 * Closes out a finished game exactly once: banks the final interval, stamps
 * finishedAt, and (for signed-in players only) writes the permanent
 * game_results row. Idempotent -- every route that can settle the last round
 * calls this, and only the first call does anything.
 *
 * Returns true if this call was the one that finalized, so the caller knows
 * to persist the session.
 */
export function finalizeIfComplete(session: GameSession, grader: Grader): boolean {
  if (session.finishedAt !== null) return false;
  if (!isComplete(session)) return false;

  const now = Date.now();
  accrue(session, now);
  session.finishedAt = now;
  // Nothing is on screen anymore -- stop the clock outright so a lingering
  // heartbeat can't keep charging a game that's already over.
  session.activeRoundIndex = null;
  session.activeSince = null;

  if (session.userId) {
    insertGameResult({
      id: session.id,
      user_id: session.userId,
      target_population: session.targetPopulation,
      only_coast: session.onlyCoast ? 1 : 0,
      total_ms: totalElapsedMs(session),
      eligible: isEligible(session) ? 1 : 0,
      rounds_json: JSON.stringify(buildResultRounds(session, grader)),
      finished_at: now,
    });
  }
  return true;
}
