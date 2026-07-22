import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { addPlayer, buildPublicState, tick } from '@/lib/server/duelLogic';
import { getCurrentUser } from '@/lib/server/auth';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lobbyId: string }> }
) {
  const { lobbyId } = await params;
  const lobby = getLobby(lobbyId);
  if (!lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const user = await getCurrentUser();
  const name = user
    ? user.username
    : typeof body?.name === 'string'
      ? body.name.trim().slice(0, 40)
      : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const grader = getGrader();
  tick(lobby, grader);
  if (lobby.status !== 'lobby') {
    return NextResponse.json({ error: 'this game has already started' }, { status: 400 });
  }
  const player = addPlayer(lobby, name, user?.id ?? null);
  saveLobby(lobby);

  return NextResponse.json({ playerId: player.id, state: buildPublicState(lobby, grader) });
}
