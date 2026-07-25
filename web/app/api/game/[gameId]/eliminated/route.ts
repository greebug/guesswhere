import { NextRequest, NextResponse } from 'next/server';
import { getGrader } from '@/lib/server/grader';
import { getGame } from '@/lib/server/gameStore';
import { isoCodeFor } from '@/lib/server/countryCode';

export const runtime = 'nodejs';

// Which countries are out of play: the countries of rounds this game has
// already settled, plus HOW each one was settled, so the minimap can tint a
// country you found in the same green as the answer box and one you gave up
// on in the same amber.
//
// SETTLED ONLY. This endpoint hands back country identities, which is answer
// information -- for an unsettled round it would be a straight-up spoiler, and
// far worse than a spoiler at the last unsolved round, where "the one country
// not yet eliminated" would name the answer's country outright. A settled
// round's country is already on screen in the answer box, so this adds
// nothing the player doesn't have.
//
// Solo only. Duels have no equivalent: rounds there are drawn one at a time
// with no country-uniqueness rule at all, so a country being used once says
// nothing about the next round (see pickNextRound in duelLogic.ts).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const session = getGame(gameId);
  if (!session) return NextResponse.json({ error: 'game not found' }, { status: 404 });

  const grader = getGrader();
  const byIso = new Map<string, { name: string; outcome: 'solved' | 'revealed' }>();
  for (const round of session.rounds) {
    if (!round.solved && !round.revealed) continue;
    const city = grader.getCityRow(round.cityId);
    if (!city) continue;
    const iso2 = isoCodeFor(city);
    if (!iso2) continue;
    // `solved` and `revealed` are mutually exclusive per round (guess/route.ts
    // and reveal/route.ts each refuse to touch an already-settled round), and
    // one country can only appear once in a game -- so there's no precedence
    // question to settle here.
    byIso.set(iso2, { name: city.country, outcome: round.solved ? 'solved' : 'revealed' });
  }

  return NextResponse.json({
    countries: [...byIso].map(([iso2, v]) => ({ iso2, name: v.name, outcome: v.outcome })),
  });
}
