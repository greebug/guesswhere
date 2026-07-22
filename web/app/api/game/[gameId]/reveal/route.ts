import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame, saveGame } from '@/lib/server/gameStore';
import { accrue, finalizeIfComplete, isComplete } from '@/lib/server/gameLogic';

export const runtime = 'nodejs';

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

  // Revealing a round already answered correctly must not overwrite it or
  // change scoring -- it just returns the name that's already displayed.
  if (!round.solved && !round.revealed) {
    const grader = getGrader();
    accrue(session); // stop this round's clock at the moment of giving up
    round.revealed = true;
    round.canonicalName = grader.revealWithCountry(round.cityId);
    // Sticky for the rest of the game: one reveal ends leaderboard contention
    // even if every other round is solved cleanly.
    session.usedReveal = true;
    finalizeIfComplete(session, grader);
    saveGame(session);
  }

  return NextResponse.json({ canonicalName: round.canonicalName, complete: isComplete(session) });
}
