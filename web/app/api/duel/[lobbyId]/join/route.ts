import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { addPlayer, buildPublicState, tick } from '@/lib/server/duelLogic';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lobbyId: string }> }
) {
  const { lobbyId } = await params;
  const lobby = getLobby(lobbyId);
  if (!lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const grader = getGrader();
  tick(lobby, grader);
  const player = addPlayer(lobby, name);
  saveLobby(lobby);

  return NextResponse.json({ playerId: player.id, state: buildPublicState(lobby, grader) });
}
