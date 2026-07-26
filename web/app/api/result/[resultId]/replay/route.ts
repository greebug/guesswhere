import { NextRequest, NextResponse } from 'next/server';
import { readGameResult } from '@/lib/server/gameDb';
import { getGrader } from '@/lib/server/grader';
import type { CityRow } from '@/lib/server/grader';
import { createRoundStates, type ResultRound } from '@/lib/server/gameLogic';
import { saveGame, newGameId } from '@/lib/server/gameStore';

export const runtime = 'nodejs';

/**
 * "Play this set": a fresh, independent playthrough of the exact cities behind
 * a finished result, in the same order.
 *
 * This is the same idea as `POST /api/game/[gameId]/clone`, but sourced from
 * `game_results` rather than the `games` table, and that difference is the
 * whole reason it exists. A result row is a permanent self-contained snapshot;
 * the game session it came from is pruned after 30 days. Every result page --
 * including the leaderboard's oldest entries -- has to stay replayable, so
 * this rebuilds the round set from the snapshot's city ids instead.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  const { resultId } = await params;
  const row = readGameResult(resultId);
  if (!row) return NextResponse.json({ error: 'result not found' }, { status: 404 });

  const grader = getGrader();
  const snapshot = JSON.parse(row.rounds_json) as ResultRound[];

  // The snapshot carries lat/lon but not min_render_zoom, so a city that has
  // since left the corpus (a `cities.sqlite` rebuild) can't be framed and
  // can't be graded either. Refuse the whole set rather than hand back a round
  // the map can't draw.
  const cities: CityRow[] = [];
  for (const r of snapshot) {
    const city = grader.getCityRow(r.cityId);
    if (!city) {
      return NextResponse.json(
        { error: 'this set is no longer playable -- one of its cities has left the city list' },
        { status: 410 }
      );
    }
    cities.push(city);
  }

  // The report blocklist is deliberately NOT applied here. A replay is a
  // verbatim rerun of one specific historical set; quietly swapping a city out
  // would make the two runs incomparable, which defeats the point.
  const now = Date.now();
  const session = {
    id: newGameId(),
    targetPopulation: row.target_population,
    onlyCoast: row.only_coast === 1,
    createdAt: now,
    rounds: createRoundStates(cities),
    // Unowned at creation, like a clone: the person who opens the result page
    // and the person who ends up playing needn't be the same. Ownership is
    // claimed by the first signed-in player (see the focus route).
    userId: null,
    activeRoundIndex: 0,
    activeSince: now,
    usedReveal: false,
    usedReport: false,
    // Never ranks -- by construction these are cities someone has already
    // played, and their times are printed on the page you started from.
    isClone: true,
    finishedAt: null,
  };
  saveGame(session);

  return NextResponse.json({ gameId: session.id });
}
