import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame, saveGame } from '@/lib/server/gameStore';
import {
  buildResultRounds,
  finalizeIfComplete,
  ineligibilityReason,
  isComplete,
  isEligible,
  totalElapsedMs,
} from '@/lib/server/gameLogic';

export const runtime = 'nodejs';

// The end-of-game breakdown. Returns city names and coordinates, so it is
// gated on the game actually being over -- otherwise it would be a way to
// read the answer key mid-round.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const session = getGame(gameId);
  if (!session) return NextResponse.json({ error: 'game not found' }, { status: 404 });

  if (!isComplete(session)) {
    return NextResponse.json({ error: 'game is not finished yet' }, { status: 409 });
  }

  const grader = getGrader();
  // Normally the guess/reveal route that settled the last round already did
  // this; this covers a game finished before finalization existed, or one
  // whose settling request died after saving.
  if (finalizeIfComplete(session, grader)) saveGame(session);

  return NextResponse.json({
    gameId: session.id,
    targetPopulation: session.targetPopulation,
    onlyCoast: session.onlyCoast,
    totalMs: totalElapsedMs(session),
    finishedAt: session.finishedAt,
    eligible: isEligible(session) && session.userId !== null,
    ineligibleReason: ineligibilityReason(session),
    rounds: buildResultRounds(session, grader),
  });
}
