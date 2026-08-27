import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, requestRematch, tick } from '@/lib/server/duelLogic';
import { gateNewGame } from '@/lib/server/gate';

export const runtime = 'nodejs';

/**
 * One player's vote to run the match again in this same lobby. The rematch
 * only starts once everyone still present has voted.
 *
 * The usage gate runs ONLY on the request that actually starts it. A rematch
 * is a new match and costs a fresh map load per player, so it has to respect
 * the monthly ceiling -- otherwise a rematch loop would be a way around it.
 * Checking every vote instead would charge one player's daily allowance
 * several times over for a single rematch, so the cost lands on whoever
 * happens to press last. That's slightly arbitrary, and it's the cheapest
 * option that leaves no hole.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lobbyId: string }> }
) {
  const { lobbyId } = await params;
  const body = await request.json().catch(() => null);
  const playerId = typeof body?.playerId === 'string' ? body.playerId : null;
  if (!playerId) return NextResponse.json({ error: 'playerId is required' }, { status: 400 });

  const lobby = getLobby(lobbyId);
  if (!lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  const grader = getGrader();
  tick(lobby, grader);

  // Dry run first: work out whether this vote would be the deciding one, so
  // the gate is consulted before anything is committed.
  const votes = new Set(lobby.rematchBy ?? []);
  votes.add(playerId);
  const wouldStart =
    lobby.status === 'finished' &&
    lobby.players.some((p) => p.id === playerId) &&
    // Mirrors requestRematch's own condition; presentPlayers is re-derived
    // there, so this is only a prediction, and a wrong prediction is
    // harmless -- it just means the gate ran a beat early or late.
    lobby.players
      .filter((p) => Date.now() - (p.lastSeenAt ?? p.joinedAt) < 20_000)
      .every((p) => votes.has(p.id));

  if (wouldStart) {
    const gate = await gateNewGame(request.headers);
    if (gate.response) return gate.response;
    const result = requestRematch(lobby, playerId);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
    if (result.started) gate.commit();
    saveLobby(lobby);
    return NextResponse.json({ started: result.started, state: buildPublicState(lobby, grader) });
  }

  const result = requestRematch(lobby, playerId);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  saveLobby(lobby);
  return NextResponse.json({ started: result.started, state: buildPublicState(lobby, grader) });
}
