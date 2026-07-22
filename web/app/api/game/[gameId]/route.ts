import { NextRequest, NextResponse } from 'next/server';
import { getGame } from '@/lib/server/gameStore';
import { correctCount, isComplete, totalElapsedMs } from '@/lib/server/gameLogic';

export const runtime = 'nodejs';

// Full session state, e.g. after a page refresh or when switching rounds.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const session = getGame(gameId);
  if (!session) return NextResponse.json({ error: 'game not found' }, { status: 404 });

  // Read-only on purpose: this doesn't accrue or re-stamp the clock. The gap
  // across a page reload is bounded by MAX_ACCRUAL_STEP_MS instead, so a
  // refresh can't be charged to the round that was open when you left.
  return NextResponse.json({
    gameId: session.id,
    targetPopulation: session.targetPopulation,
    onlyCoast: session.onlyCoast,
    correctCount: correctCount(session),
    elapsedMs: totalElapsedMs(session),
    complete: isComplete(session),
    rounds: session.rounds.map((r, i) => ({
      index: i,
      lat: r.lat,
      lon: r.lon,
      minRenderZoom: r.minRenderZoom,
      solved: r.solved,
      revealed: r.revealed,
      canonicalName: r.solved || r.revealed ? r.canonicalName : null,
    })),
  });
}
