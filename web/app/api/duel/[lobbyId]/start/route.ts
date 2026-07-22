import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, startLobby } from '@/lib/server/duelLogic';

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
  if (playerId !== lobby.hostPlayerId) {
    return NextResponse.json({ error: 'only the host can start the game' }, { status: 403 });
  }
  if (lobby.status !== 'lobby') {
    return NextResponse.json({ error: 'game already started' }, { status: 400 });
  }

  const grader = getGrader();
  try {
    startLobby(lobby, grader);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to start game' }, { status: 400 });
  }
  saveLobby(lobby);

  return NextResponse.json({ state: buildPublicState(lobby, grader) });
}
