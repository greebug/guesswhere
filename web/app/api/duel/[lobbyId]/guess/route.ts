import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, submitGuess, tick } from '@/lib/server/duelLogic';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lobbyId: string }> }
) {
  const { lobbyId } = await params;
  const lobby = getLobby(lobbyId);
  if (!lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
  const guess = typeof body?.guess === 'string' ? body.guess : '';
  if (!lobby.players.some((p) => p.id === playerId)) {
    return NextResponse.json({ error: 'unknown playerId' }, { status: 403 });
  }

  const grader = getGrader();
  tick(lobby, grader);
  const result = submitGuess(lobby, playerId, guess, grader);
  saveLobby(lobby);

  return NextResponse.json({ ...result, state: buildPublicState(lobby, grader) });
}
