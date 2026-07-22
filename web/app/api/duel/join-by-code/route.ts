import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobbyByJoinCode, saveLobby } from '@/lib/server/duelStore';
import { addPlayer, buildPublicState, tick } from '@/lib/server/duelLogic';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const lobby = getLobbyByJoinCode(code);
  if (!lobby) return NextResponse.json({ error: 'no lobby found with that code' }, { status: 404 });

  const grader = getGrader();
  tick(lobby, grader);
  if (lobby.status !== 'lobby') {
    return NextResponse.json({ error: 'this game has already started' }, { status: 400 });
  }

  const player = addPlayer(lobby, name);
  saveLobby(lobby);

  return NextResponse.json({ lobbyId: lobby.id, playerId: player.id, state: buildPublicState(lobby, grader) });
}
