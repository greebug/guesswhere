import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame, saveGame } from '@/lib/server/gameStore';

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
    round.revealed = true;
    round.canonicalName = getGrader().revealWithCountry(round.cityId);
    saveGame(session);
  }

  return NextResponse.json({ canonicalName: round.canonicalName });
}
