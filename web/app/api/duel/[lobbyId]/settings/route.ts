import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { buildPublicState, tick } from '@/lib/server/duelLogic';

export const runtime = 'nodejs';

const TIMER_MIN_S = 30;
const TIMER_MAX_S = 600;
const TARGET_MIN = 1;
const TARGET_MAX = 15;

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
    return NextResponse.json({ error: 'only the host can change settings' }, { status: 403 });
  }
  if (lobby.status !== 'lobby') {
    return NextResponse.json({ error: 'settings can only be changed before the game starts' }, { status: 400 });
  }

  const timerSeconds = Number(body?.timerSeconds);
  const targetRounds = Number(body?.targetRounds);
  const targetPopulation = Number(body?.targetPopulation);
  const onlyCoast = body?.onlyCoast === true;

  if (!Number.isFinite(timerSeconds) || timerSeconds < TIMER_MIN_S || timerSeconds > TIMER_MAX_S) {
    return NextResponse.json({ error: `timerSeconds must be between ${TIMER_MIN_S} and ${TIMER_MAX_S}` }, { status: 400 });
  }
  if (!Number.isInteger(targetRounds) || targetRounds < TARGET_MIN || targetRounds > TARGET_MAX) {
    return NextResponse.json({ error: `targetRounds must be an integer between ${TARGET_MIN} and ${TARGET_MAX}` }, { status: 400 });
  }
  if (!Number.isFinite(targetPopulation) || targetPopulation <= 0) {
    return NextResponse.json({ error: 'targetPopulation must be a positive number' }, { status: 400 });
  }

  lobby.settings = { timerSeconds, targetRounds, targetPopulation, onlyCoast };
  const grader = getGrader();
  tick(lobby, grader);
  saveLobby(lobby);

  return NextResponse.json({ state: buildPublicState(lobby, grader) });
}
