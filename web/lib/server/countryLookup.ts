import fs from 'node:fs';
import path from 'node:path';

// web/data/country-borders.json is Natural Earth's 110m admin-0 countries
// (public domain, https://www.naturalearthdata.com/), stripped down to just
// {name, geometry} and coordinates rounded to 3 decimal places (~110m,
// matching the source resolution) to keep it small -- ~186KB vs. the raw
// file's ~840KB with 168 unused attribute columns per feature. This is only
// used for "which country is roughly under this point" to label a border on
// the minimap; it's not rendered, so 110m precision is plenty.
const FILE_PATH = path.join(process.cwd(), 'data', 'country-borders.json');

type Ring = number[][]; // [lon, lat][]
type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] };

interface RawCountry {
  name: string;
  geometry: Geometry;
}

interface Country {
  name: string;
  geometry: Geometry;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
}

let cache: Country[] | null = null;

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
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
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

function pointInGeometry(lon: number, lat: number, geometry: Geometry): boolean {
  if (geometry.type === 'Polygon') return pointInPolygon(lon, lat, geometry.coordinates);
  return geometry.coordinates.some((rings) => pointInPolygon(lon, lat, rings));
}

/** Which country (if any) a point falls in. Only 177 features and a bbox
 * pre-filter on each, so this is a plain linear scan rather than a spatial
 * index -- comfortably sub-millisecond at this feature count. */
export function countryAt(lat: number, lon: number): string | null {
  for (const country of load()) {
    const [minLon, minLat, maxLon, maxLat] = country.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    if (pointInGeometry(lon, lat, country.geometry)) return country.name;
  }
  return null;
}
