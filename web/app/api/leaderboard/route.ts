import { NextRequest, NextResponse } from 'next/server';
import { readLeaderboard } from '@/lib/server/gameDb';
import { BOARD_POPULATIONS, LEADERBOARD_SIZE, isBoardPopulation } from '@/lib/boards';

export const runtime = 'nodejs';

// One tier's two boards, or every board at once when `population` is omitted
// -- the home page wants all eight lists in a single request rather than
// eight round-trips as the user flips tabs.
export async function GET(request: NextRequest) {
  const populationParam = request.nextUrl.searchParams.get('population');

  if (populationParam !== null) {
    const population = Number(populationParam);
    if (!isBoardPopulation(population)) {
      return NextResponse.json({ error: 'no leaderboard for that population' }, { status: 400 });
    }
    return NextResponse.json({
      boards: [
        {
          population,
          onlyCoast: false,
          entries: readLeaderboard(population, false, LEADERBOARD_SIZE),
        },
        {
          population,
          onlyCoast: true,
          entries: readLeaderboard(population, true, LEADERBOARD_SIZE),
        },
      ],
    });
  }

  const boards = BOARD_POPULATIONS.flatMap((population) =>
    [false, true].map((onlyCoast) => ({
      population,
      onlyCoast,
      entries: readLeaderboard(population, onlyCoast, LEADERBOARD_SIZE),
    }))
  );
  return NextResponse.json({ boards });
}
