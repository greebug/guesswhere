import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame, saveGame } from '@/lib/server/gameStore';
import { accrue, pickReplacementCity } from '@/lib/server/gameLogic';
import { getReportedIds, addReportedId } from '@/lib/server/reportedCities';

export const runtime = 'nodejs';

// "Report round": for bad/unusable imagery (heavy cloud cover, etc.) --
// distinct from Reveal, which is "I give up on this one." Reporting:
//  1. Adds the city to a persisted, global blocklist (reportedCities.ts) so
//     it never comes up again, in this game or any future one.
//  2. Immediately replaces it with a different city, same population tier,
//     still respecting "no repeat country" against the OTHER 9 rounds.
//
// Solo-only for now. The user's ask also covers a duels/ranked mode where
// a round only skips once BOTH players press it -- that requires an actual
// shared multiplayer session (phase 5, not built yet: see PLAN.md). This
// keeps the exclusion-list and replacement-selection pieces so that when
// multiplayer lands, only the "requires N confirmations" layer needs adding
// on top, not the underlying mechanic.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const session = getGame(gameId);
  if (!session) return NextResponse.json({ error: 'game not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const roundIndex = Number(body?.roundIndex);
  const round = session.rounds[roundIndex];
  if (!round) return NextResponse.json({ error: 'invalid roundIndex' }, { status: 400 });

  const grader = getGrader();
  addReportedId(round.cityId);

  const otherCountries = new Set(
    session.rounds
      .filter((_, i) => i !== roundIndex)
      .map((r) => grader.getCityRow(r.cityId)?.country)
      .filter((c): c is string => !!c)
  );

  let replacement;
  try {
    replacement = pickReplacementCity(
      session.targetPopulation,
      grader,
      getReportedIds(),
      otherCountries,
      session.onlyCoast
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to pick replacement' }, { status: 400 });
  }

  // Bank whatever was spent staring at the unusable imagery, then zero it:
  // the slot now holds a different city, and time lost to a bad round isn't
  // time spent on the replacement.
  accrue(session);

  round.cityId = replacement.id;
  round.lat = replacement.lat;
  round.lon = replacement.lon;
  round.minRenderZoom = replacement.min_render_zoom;
  round.solved = false;
  round.revealed = false;
  round.canonicalName = null;
  round.elapsedMs = 0;
  // Sticky, like usedReveal -- reporting ends leaderboard contention for this
  // game, so a fresh city can't be farmed for an easier time.
  session.usedReport = true;
  saveGame(session);

  return NextResponse.json({
    round: {
      index: roundIndex,
      lat: round.lat,
      lon: round.lon,
      minRenderZoom: round.minRenderZoom,
      solved: false,
      revealed: false,
      canonicalName: null,
    },
  });
}
