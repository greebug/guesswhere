import { NextResponse } from 'next/server';
import { getCurrentUser, toPublicUser } from '@/lib/server/auth';
import { readUserResults, readUserStats } from '@/lib/server/gameDb';

export const runtime = 'nodejs';

// How many recent games the profile lists. Every completed game is kept --
// lifetime stats need the full history to be honest -- so this is purely a
// display limit and safe to change.
const RECENT_GAMES = 10;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const stats = readUserStats(user.id);
  const recent = readUserResults(user.id, RECENT_GAMES);

  return NextResponse.json({
    user: toPublicUser(user),
    stats: {
      games: stats.games,
      eligible: stats.eligible,
      avgMs: stats.avg_ms,
      bestMs: stats.best_ms,
    },
    recent: recent.map((r) => ({
      id: r.id,
      targetPopulation: r.target_population,
      onlyCoast: r.only_coast === 1,
      totalMs: r.total_ms,
      eligible: r.eligible === 1,
      finishedAt: r.finished_at,
    })),
  });
}
