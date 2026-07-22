import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, tick } from '@/lib/server/duelLogic';

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
  if (JSON.stringify(lobby) !== before) saveLobby(lobby);

  return NextResponse.json({ state: buildPublicState(lobby, grader) });
}
