import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { createLobby, buildPublicState, type DuelSettings } from '@/lib/server/duelLogic';
import { saveLobby } from '@/lib/server/duelStore';

export const runtime = 'nodejs';

const TIMER_MIN_S = 30;
const TIMER_MAX_S = 600;
const TARGET_MIN = 1;
const TARGET_MAX = 15;

function parseSettings(body: unknown): DuelSettings | { error: string } {
  const b = body as Record<string, unknown> | null;
  const timerSeconds = Number(b?.timerSeconds);
  const targetRounds = Number(b?.targetRounds);
  const targetPopulation = Number(b?.targetPopulation);
  const onlyCoast = b?.onlyCoast === true;

  if (!Number.isFinite(timerSeconds) || timerSeconds < TIMER_MIN_S || timerSeconds > TIMER_MAX_S) {
    return { error: `timerSeconds must be between ${TIMER_MIN_S} and ${TIMER_MAX_S}` };
  }
  if (!Number.isInteger(targetRounds) || targetRounds < TARGET_MIN || targetRounds > TARGET_MAX) {
    return { error: `targetRounds must be an integer between ${TARGET_MIN} and ${TARGET_MAX}` };
  }
  if (!Number.isFinite(targetPopulation) || targetPopulation <= 0) {
    return { error: 'targetPopulation must be a positive number' };
  }
  return { timerSeconds, targetRounds, targetPopulation, onlyCoast };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const settings = parseSettings(body);
  if ('error' in settings) return NextResponse.json({ error: settings.error }, { status: 400 });

  const lobby = createLobby(name, settings);
  saveLobby(lobby);

  return NextResponse.json({
    lobbyId: lobby.id,
    playerId: lobby.hostPlayerId,
    state: buildPublicState(lobby, getGrader()),
  });
}
