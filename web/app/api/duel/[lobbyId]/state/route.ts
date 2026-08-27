import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, markSeen, tick } from '@/lib/server/duelLogic';

export const runtime = 'nodejs';

// Polled by every client every ~750ms -- also the mechanism by which a
// passive viewer (not the one guessing) still catches a round timing out,
// since tick() runs here too (see duelLogic.ts's tick-on-read notes).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lobbyId: string }> }
) {
  const { lobbyId } = await params;
  const lobby = getLobby(lobbyId);
  if (!lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  const grader = getGrader();
  const before = JSON.stringify(lobby);
  tick(lobby, grader);

  // This poll is the only continuous signal a client gives us, so it doubles
  // as the presence heartbeat that the rematch vote counts against. Optional
  // param: a client that doesn't send it still gets state, it just won't be
  // counted as present.
  const playerId = request.nextUrl.searchParams.get('playerId');
  if (playerId) markSeen(lobby, playerId);

  if (JSON.stringify(lobby) !== before) saveLobby(lobby);

  return NextResponse.json({ state: buildPublicState(lobby, grader) });
}
