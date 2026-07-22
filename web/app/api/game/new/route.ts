import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { selectRound, createRoundStates } from '@/lib/server/gameLogic';
import { saveGame, newGameId } from '@/lib/server/gameStore';
import { getReportedIds } from '@/lib/server/reportedCities';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const targetPopulation = Number(body?.targetPopulation);
  if (!Number.isFinite(targetPopulation) || targetPopulation <= 0) {
    return NextResponse.json({ error: 'targetPopulation must be a positive number' }, { status: 400 });
  }
  const onlyCoast = body?.onlyCoast === true;

  const grader = getGrader();
  let cities;
  try {
    cities = selectRound(targetPopulation, grader, getReportedIds(), onlyCoast);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to select round' }, { status: 400 });
  }
  const rounds = createRoundStates(cities);

  const session = {
    id: newGameId(),
    targetPopulation,
    onlyCoast,
    createdAt: Date.now(),
    rounds,
  };
  saveGame(session);

  // Never send canonical_name/aliases to the client -- only what's needed to
  // render imagery and track progress (PLAN.md: answer never reaches client).
  return NextResponse.json({
    gameId: session.id,
    rounds: rounds.map((r, i) => ({
      index: i,
      lat: r.lat,
      lon: r.lon,
      minRenderZoom: r.minRenderZoom,
      solved: r.solved,
      revealed: r.revealed,
    })),
  });
}
