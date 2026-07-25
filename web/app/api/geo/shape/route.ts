import { NextRequest, NextResponse } from 'next/server';
import { shapeForIso } from '@/lib/server/countryLookup';

export const runtime = 'nodejs';

// One country's outline, as a GeoJSON Feature, keyed by ISO 3166-1 alpha-2.
//
// Deliberately one country per request rather than a batch: the minimap asks
// for a country's shape the moment it's eliminated, and a URL per country lets
// the browser's own HTTP cache do the deduplication -- across rounds, across
// games, and across page reloads. A batched ?iso=CA,RU endpoint would produce
// a different URL for every combination and re-download Canada ten times in a
// ten-round game.
//
// Public-domain Natural Earth geometry with no relation to the answer key, so
// there's nothing here to gate behind a game session.
export async function GET(request: NextRequest) {
  const iso2 = (request.nextUrl.searchParams.get('iso') ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) {
    return NextResponse.json({ error: 'pass iso=<2-letter country code>' }, { status: 400 });
  }

  const shape = shapeForIso(iso2);
  if (!shape) return NextResponse.json({ error: 'no shape for that code' }, { status: 404 });

  return NextResponse.json(
    {
      type: 'Feature',
      id: iso2,
      properties: { iso2, name: shape.name },
      geometry: shape.geometry,
    },
    {
      // The shapes only change when tools/build-country-shapes.js is re-run
      // and the app redeployed, so this is safe to pin hard.
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    }
  );
}
