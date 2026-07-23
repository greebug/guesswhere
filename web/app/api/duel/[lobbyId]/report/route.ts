import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, reportRound, tick } from '@/lib/server/duelLogic';

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
  if (!lobby.players.some((p) => p.id === playerId)) {
    return NextResponse.json({ error: 'unknown playerId' }, { status: 403 });
  }

  const grader = getGrader();
  tick(lobby, grader);
  try {
    reportRound(lobby, playerId, grader);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to report round' }, { status: 400 });
  }
  saveLobby(lobby);

  return NextResponse.json({ state: buildPublicState(lobby, grader) });
}
