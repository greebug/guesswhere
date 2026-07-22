import { NextRequest, NextResponse } from 'next/server';
import { countryAt } from '@/lib/server/countryLookup';

export const runtime = 'nodejs';

const MAX_POINTS = 6;

// Batched (repeated ?point=lat,lon) so the minimap can resolve both sides of
// a border in one round trip instead of one request per point.
export async function GET(request: NextRequest) {
  const points = request.nextUrl.searchParams.getAll('point');
  if (points.length === 0 || points.length > MAX_POINTS) {
    return NextResponse.json({ error: `pass 1-${MAX_POINTS} point=lat,lon params` }, { status: 400 });
  }

  const countries = points.map((raw) => {
    const [latStr, lonStr] = raw.split(',');
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return countryAt(lat, lon);
  });

  return NextResponse.json({ countries });
}
