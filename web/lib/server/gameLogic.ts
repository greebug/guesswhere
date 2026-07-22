import type { CityRow, Grader } from './grader';

const ROUNDS_PER_GAME = 10;

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

export function selectRound(
  minPopulation: number,
  grader: Grader,
  excludeIds: Set<number> = new Set()
): CityRow[] {
  const pool = grader.allCities().filter((c) => !excludeIds.has(c.id));
  const picked = pickCitiesAtOrAbove(minPopulation, pool, ROUNDS_PER_GAME, new Set());
  if (picked.length < ROUNDS_PER_GAME) {
    throw new Error(
      `only found ${picked.length} cities with population >= ${minPopulation} -- corpus may be too small at this floor`
    );
  }
  return picked;
}

/** Single replacement city for the "report round" flow -- see report/route.ts. */
export function pickReplacementCity(
  minPopulation: number,
  grader: Grader,
  excludeIds: Set<number>,
  excludeCountries: Set<string>
): CityRow {
  const pool = grader.allCities().filter((c) => !excludeIds.has(c.id));
  const [picked] = pickCitiesAtOrAbove(minPopulation, pool, 1, excludeCountries);
  if (!picked) {
    throw new Error(
      `no replacement city available with population >= ${minPopulation} (excluding reported cities)`
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
}

export interface GameSession {
  id: string;
  targetPopulation: number;
  createdAt: number;
  rounds: RoundState[];
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
  }));
}

export function correctCount(session: GameSession): number {
  return session.rounds.filter((r) => r.solved).length;
}
