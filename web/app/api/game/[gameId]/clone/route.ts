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

  const clone = {
    id: newGameId(),
    targetPopulation: source.targetPopulation,
    onlyCoast: source.onlyCoast,
    createdAt: Date.now(),
    rounds: cloneRoundStates(source.rounds),
  };
  saveGame(clone);

  return NextResponse.json({ gameId: clone.id });
}
