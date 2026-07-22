import { NextRequest, NextResponse } from 'next/server';
import { getGame, saveGame } from '@/lib/server/gameStore';
import { setActiveRound, totalElapsedMs } from '@/lib/server/gameLogic';
import { getCurrentUser } from '@/lib/server/auth';

export const runtime = 'nodejs';

// "The player is looking at round N." Serves double duty as the pagination
// signal and as a heartbeat: the client re-posts the current round every few
// seconds, which both banks elapsed time incrementally and bounds how much a
// vanished client (closed tab, dead network) can leave on the clock -- see
// MAX_ACCRUAL_STEP_MS in gameLogic.ts.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const session = getGame(gameId);
  if (!session) return NextResponse.json({ error: 'game not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const roundIndex = Number(body?.roundIndex);
  if (!Number.isInteger(roundIndex) || !session.rounds[roundIndex]) {
    return NextResponse.json({ error: 'invalid roundIndex' }, { status: 400 });
  }

  // A finished game's clock stays stopped -- a client that keeps beating after
  // the report appears must not resurrect it.
  if (session.finishedAt !== null) {
    return NextResponse.json({ elapsedMs: totalElapsedMs(session), complete: true });
  }

  // Clones are created unowned, by the sharer's browser rather than the
  // player's (see the clone route). The first signed-in player to actually
  // touch it claims it, so it lands in the right profile history.
  //
  // Restricted to clones on purpose: a normal game's owner is fixed when it's
  // created, so signing in halfway through a guest run doesn't retroactively
  // claim it.
  if (session.isClone && session.userId === null) {
    const user = await getCurrentUser();
    if (user) session.userId = user.id;
  }

  setActiveRound(session, roundIndex);
  saveGame(session);

  return NextResponse.json({
    elapsedMs: totalElapsedMs(session),
    roundElapsedMs: session.rounds[roundIndex].elapsedMs,
    complete: false,
  });
}
