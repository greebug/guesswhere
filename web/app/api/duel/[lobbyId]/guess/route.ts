import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, submitGuess, tick } from '@/lib/server/duelLogic';
import { logIfSlow } from '@/lib/server/slowLog';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lobbyId: string }> }
) {
  const startedAt = performance.now();
  const { lobbyId } = await params;

  // Body FIRST, lobby second, and the order is the whole point.
  //
  // This used to read the lobby and then `await request.json()`, which left an
  // await between reading the lobby and writing it back. Node runs one request
  // at a time, so every other handler here is atomic between its read and its
  // save -- but an await yields, and another request can complete a full
  // read-modify-write inside that window. This handler would then resume
  // holding its pre-await snapshot and write that back, silently discarding
  // whatever happened in between: a round advanced by a timing-out poll, or
  // another player's winning guess.
  //
  // Reading the lobby after the body leaves no await between the read and the
  // save, which is what makes the sequence safe.
  const body = await request.json().catch(() => null);
  const lobby = getLobby(lobbyId);
  if (!lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
  const guess = typeof body?.guess === 'string' ? body.guess : '';
  if (!lobby.players.some((p) => p.id === playerId)) {
    return NextResponse.json({ error: 'unknown playerId' }, { status: 403 });
  }

  const grader = getGrader();
  tick(lobby, grader);
  const result = submitGuess(lobby, playerId, guess, grader);
  saveLobby(lobby);

  const response = NextResponse.json({ ...result, state: buildPublicState(lobby, grader) });
  logIfSlow(`guess ${lobbyId}`, startedAt);
  return response;
}
