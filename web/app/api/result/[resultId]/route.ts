import { NextRequest, NextResponse } from 'next/server';
import { readGameResult } from '@/lib/server/gameDb';
import type { ResultRound } from '@/lib/server/gameLogic';

export const runtime = 'nodejs';

// Reads game_results, never the game session -- results are self-contained
// snapshots, which is what keeps these pages alive after the prune sweep has
// dropped the underlying session.
//
// Public by design: these are the detail pages behind leaderboard rows. Only
// the username is exposed, never an email or anything else from the account.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  const { resultId } = await params;
  const row = readGameResult(resultId);
  if (!row) return NextResponse.json({ error: 'result not found' }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    username: row.username,
    targetPopulation: row.target_population,
    onlyCoast: row.only_coast === 1,
    totalMs: row.total_ms,
    eligible: row.eligible === 1,
    finishedAt: row.finished_at,
    rounds: JSON.parse(row.rounds_json) as ResultRound[],
  });
}
