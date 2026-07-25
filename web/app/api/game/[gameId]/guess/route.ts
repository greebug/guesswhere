import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame, saveGame } from '@/lib/server/gameStore';
import { accrue, correctCount, finalizeIfComplete, isComplete } from '@/lib/server/gameLogic';

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
      complete: isComplete(session),
    });
  }

  // Bank the time BEFORE grading, so a correct guess stops this round's clock
  // at the instant it was submitted rather than at the next heartbeat.
  accrue(session);

  const grader = getGrader();
  const result = grader.grade(round.cityId, guess);
  if (result.correct) {
    round.solved = true;
    // "City, Country" even on a correct guess. The country was never required
    // to type and still isn't -- grade() accepts the bare city name exactly as
    // before -- but showing it makes a solved round readable at a glance when
    // paging back through the ten, which is the whole point of being able to
    // page back. It also feeds the eliminated-country tint's rationale: the
    // player can see which country they just knocked out.
    round.canonicalName = grader.revealWithCountry(round.cityId) ?? result.canonicalName;
  }
  // A wrong guess still moved the clock, so this saves either way.
  finalizeIfComplete(session, grader);
  saveGame(session);

  return NextResponse.json({
    correct: result.correct,
    canonicalName: result.correct ? round.canonicalName : null,
    correctCount: correctCount(session),
    complete: isComplete(session),
  });
}
