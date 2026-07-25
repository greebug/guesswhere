import fs from 'node:fs';
import path from 'node:path';

// web/data/country-shapes.json is Natural Earth's 50m admin-0 countries (public
// domain, https://www.naturalearthdata.com/), stripped to {iso2, name,
// geometry} and simplified -- see tools/build-country-shapes.js, which
// regenerates it and documents the tradeoffs.
//
// Two consumers, and they want different things from it:
//   * countryAt()   -- "which country is roughly under this point", for the
//                      minimap's border labels. Point-tested, never drawn.
//   * shapeForIso() -- the polygon itself, served to the client to tint a
//                      country the player has already eliminated.
const FILE_PATH = path.join(process.cwd(), 'data', 'country-shapes.json');

type Ring = number[][]; // [lon, lat][]
type Geometry = { type: 'MultiPolygon'; coordinates: Ring[][] };

interface RawCountry {
  iso2: string;
  name: string;
  geometry: Geometry;
}

interface Country extends RawCountry {
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
}

export interface CountryRef {
  iso2: string;
  name: string;
}

let cache: Country[] | null = null;
let byIso: Map<string, Country> | null = null;

function ringBbox(ring: Ring): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function geometryBbox(geometry: Geometry): [number, number, number, number] {
  const rings = geometry.coordinates.flat();
  let [minLon, minLat, maxLon, maxLat] = ringBbox(rings[0]);
  for (const ring of rings.slice(1)) {
    const [rMinLon, rMinLat, rMaxLon, rMaxLat] = ringBbox(ring);
    if (rMinLon < minLon) minLon = rMinLon;
    if (rMaxLon > maxLon) maxLon = rMaxLon;
    if (rMinLat < minLat) minLat = rMinLat;
    if (rMaxLat > maxLat) maxLat = rMaxLat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function load(): Country[] {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')) as RawCountry[];
  cache = raw.map((c) => ({ ...c, bbox: geometryBbox(c.geometry) }));
  byIso = new Map(cache.map((c) => [c.iso2, c]));
  return cache;
}

// Standard ray-casting point-in-polygon test.
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// GeoJSON convention: a polygon's first ring is the exterior, any further
// rings are holes to subtract (islands-within-lakes-within-countries are
// rare but real -- Lesotho-in-South-Africa is the classic case, handled
// here as a whole separate polygon rather than a hole, so this is really
// just for the general case).
function pointInPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (const hole of rings.slice(1)) {
    if (pointInRing(lon, lat, hole)) return false;
  }
  return true;
}

/** Which country (if any) a point falls in. Only ~240 features and a bbox
 * pre-filter on each, so this is a plain linear scan rather than a spatial
 * index -- comfortably sub-millisecond at this feature count. */
export function countryAt(lat: number, lon: number): CountryRef | null {
  for (const country of load()) {
    const [minLon, minLat, maxLon, maxLat] = country.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    if (country.geometry.coordinates.some((rings) => pointInPolygon(lon, lat, rings))) {
      return { iso2: country.iso2, name: country.name };
    }
  }
  return null;
}

/** The raw MultiPolygon for one ISO 3166-1 alpha-2 code, or null if Natural
 * Earth has no separate feature for it. Null is a normal outcome, not an
 * error: France's overseas departments (Guadeloupe, Martinique, Réunion,
 * Mayotte, French Guiana) have their own ISO codes but are folded into
 * France's own geometry upstream, so those cities simply go untinted rather
 * than tinting mainland France by mistake. 17 cities in the whole corpus. */
export function shapeForIso(iso2: string): { name: string; geometry: Geometry } | null {
  load();
  const c = byIso!.get(iso2);
  return c ? { name: c.name, geometry: c.geometry } : null;
}
