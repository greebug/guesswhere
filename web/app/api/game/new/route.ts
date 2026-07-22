import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { selectRound, createRoundStates } from '@/lib/server/gameLogic';
import { saveGame, newGameId } from '@/lib/server/gameStore';
import { getReportedIds } from '@/lib/server/reportedCities';
import { getCurrentUser } from '@/lib/server/auth';
import { pruneIfDue } from '@/lib/server/gameDb';

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

  // Ownership is fixed at creation. Signing in mid-game doesn't retroactively
  // claim a run that was started anonymously.
  const user = await getCurrentUser();
  const now = Date.now();

  const session = {
    id: newGameId(),
    targetPopulation,
    onlyCoast,
    createdAt: now,
    rounds,
    userId: user?.id ?? null,
    // The clock starts on round 0 immediately -- the player is already looking
    // at it by the time this response lands.
    activeRoundIndex: 0,
    activeSince: now,
    usedReveal: false,
    usedReport: false,
    isClone: false,
    finishedAt: null,
  };
  saveGame(session);

  // Cheap no-op unless a day has passed; keeps the volume from creeping back
  // up without needing a separate cron process.
  pruneIfDue();

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
