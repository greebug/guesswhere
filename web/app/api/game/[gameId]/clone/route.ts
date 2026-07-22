import { NextRequest, NextResponse } from 'next/server';
import { getGame, saveGame, newGameId } from '@/lib/server/gameStore';
import { cloneRoundStates } from '@/lib/server/gameLogic';

export const runtime = 'nodejs';

// "Share these cities": a friend gets their own independent playthrough of
// the exact same round set (same cities, same order), not a shared/live
// session -- solving a round here never affects the original game.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const source = getGame(gameId);
  if (!source) return NextResponse.json({ error: 'game not found' }, { status: 404 });

  // Deliberately unowned at creation: this endpoint is called by the person
  // SHARING, but the person PLAYING is whoever opens the link. Ownership is
  // claimed by the first signed-in player instead (see the focus route).
  const now = Date.now();

  const clone = {
    id: newGameId(),
    targetPopulation: source.targetPopulation,
    onlyCoast: source.onlyCoast,
    createdAt: now,
    rounds: cloneRoundStates(source.rounds),
    userId: null,
    activeRoundIndex: 0,
    activeSince: now,
    usedReveal: false,
    usedReport: false,
    // Shared sets never rank. By construction these are cities someone has
    // already played, so without this you could finish a game, clone it, and
    // speedrun the answers you just memorized straight to the top of the
    // board. The cost is that a friend seeing the set fresh can't rank either
    // -- the server can't tell those two cases apart, and for a leaderboard
    // the safe direction is obvious.
    isClone: true,
    finishedAt: null,
  };
  saveGame(clone);

  return NextResponse.json({ gameId: clone.id });
}
