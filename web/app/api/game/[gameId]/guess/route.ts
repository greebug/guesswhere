import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame, saveGame } from '@/lib/server/gameStore';
import { correctCount } from '@/lib/server/gameLogic';

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
  const guess = typeof body?.guess === 'string' ? body.guess : '';

  const round = session.rounds[roundIndex];
  if (!round) return NextResponse.json({ error: 'invalid roundIndex' }, { status: 400 });

  // Already-settled rounds (solved or revealed) are read-only: a correct
  // guess here can't retroactively un-reveal or double-score. Keeps the box
  // "un-editable" once green, matching the original game's behavior.
  if (round.solved || round.revealed) {
    return NextResponse.json({
      correct: round.solved,
      canonicalName: round.canonicalName,
      correctCount: correctCount(session),
    });
  }

  const result = getGrader().grade(round.cityId, guess);
  if (result.correct) {
    round.solved = true;
    round.canonicalName = result.canonicalName;
    saveGame(session);
  }

  return NextResponse.json({
    correct: result.correct,
    canonicalName: result.correct ? result.canonicalName : null,
    correctCount: correctCount(session),
  });
}
