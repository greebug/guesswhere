import { NextRequest, NextResponse } from 'next/server';
import { getGame, saveGame } from '@/lib/server/gameStore';
import { getLobby, saveLobby } from '@/lib/server/duelStore';
import { MAX_LOADS_PER_SESSION, recordMapLoad } from '@/lib/server/usage';

export const runtime = 'nodejs';

/**
 * Called once by MainMap when a Mapbox map finishes loading -- the exact event
 * Mapbox bills for, reported from the only place that knows it happened.
 *
 * Counting game creations instead would have been simpler and wrong in both
 * directions: a refresh is a second billed load against one game, and someone
 * who creates a game but closes the tab before the map draws is billed for
 * none.
 *
 * Two things keep the meter honest against a forged client. The id has to name
 * a real session or lobby, and each of those can only ever contribute
 * MAX_LOADS_PER_SESSION. Without the cap anyone could POST in a loop and trip
 * the spend ceiling -- turning a cost control into a way to take the game
 * down. Always answers 200, so it never reveals which ids exist.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : null;
  const kind = body?.kind === 'duel' ? 'duel' : 'game';
  if (!id) return NextResponse.json({ ok: true });

  if (kind === 'duel') {
    const lobby = getLobby(id);
    if (!lobby) return NextResponse.json({ ok: true });
    if ((lobby.mapLoads ?? 0) >= MAX_LOADS_PER_SESSION) return NextResponse.json({ ok: true });
    lobby.mapLoads = (lobby.mapLoads ?? 0) + 1;
    saveLobby(lobby);
  } else {
    const session = getGame(id);
    if (!session) return NextResponse.json({ ok: true });
    if ((session.mapLoads ?? 0) >= MAX_LOADS_PER_SESSION) return NextResponse.json({ ok: true });
    session.mapLoads = (session.mapLoads ?? 0) + 1;
    saveGame(session);
  }

  recordMapLoad();
  return NextResponse.json({ ok: true });
}
