// One-off simulation for Jesse: runs the REAL selectRound() from
// lib/server/gameLogic.ts thousands of times at the 2,000,000-population,
// coast-only tier, and tallies how often each eligible city gets picked.
//
// Deliberately does not reimplement the shuffle-and-scan algorithm -- it
// imports and calls the actual production code (same as every other script
// in this directory), so the result reflects what the live game does, not
// an approximation of it.
import { getGrader } from '../lib/server/grader.ts';
import { selectRound } from '../lib/server/gameLogic.ts';

const TRIALS = Number(process.argv[2] ?? 5000);
const MIN_POPULATION = 2_000_000;
const ONLY_COAST = true;

const grader = getGrader();

const counts = new Map(); // cityId -> times picked
const gamesContaining = new Map(); // cityId -> games it appeared in (== counts here, no repeats within a game)
let totalPicks = 0;

for (let i = 0; i < TRIALS; i++) {
  const round = selectRound(MIN_POPULATION, grader, new Set(), ONLY_COAST);
  for (const city of round) {
    counts.set(city.id, (counts.get(city.id) ?? 0) + 1);
    totalPicks += 1;
  }
}

// The full eligible pool, independent of whether every city happened to get
// drawn -- a city with 0 picks must still appear in the output.
const pool = grader
  .allCities()
  .filter((c) => c.pop_ghsl >= MIN_POPULATION)
  .filter((c) => c.dist_to_coast_km !== null && c.dist_to_coast_km <= 20 * 1.609344);

const rows = pool
  .map((c) => ({
    id: c.id,
    name: c.canonical_name,
    country: c.country,
    population: c.pop_ghsl,
    picks: counts.get(c.id) ?? 0,
  }))
  .sort((a, b) => b.picks - a.picks);

const zeroPickCities = rows.filter((r) => r.picks === 0);

console.log(JSON.stringify({
  trials: TRIALS,
  roundsPerTrial: 10,
  totalPicks,
  poolSize: pool.length,
  citiesEverPicked: pool.length - zeroPickCities.length,
  citiesNeverPicked: zeroPickCities.length,
  meanPicksPerCity: totalPicks / pool.length,
  expectedPicksIfUniform: (TRIALS * 10) / pool.length,
  rows,
}));
