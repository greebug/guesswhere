#!/usr/bin/env node
// Regenerates web/data/country-shapes.json from Natural Earth's 1:50m admin-0
// countries (public domain, https://www.naturalearthdata.com/).
//
//   node tools/build-country-shapes.js
//
// The raw file is ~3MB with 40+ unused attribute columns per feature. This
// strips it to {iso2, name, geometry} with coordinates rounded to 3 decimal
// places (~110m, well below the source's own ~1km generalization) -- small
// enough to sit in the repo and to load once into a server process.
//
// It replaced an earlier 110m, name-only country-borders.json for two reasons:
//   * ISO codes. The city DB's `country` strings come from two upstream sources
//     that disagree ("United States" vs "United States of America", "Burma" vs
//     "Myanmar"), so name matching against Natural Earth was hopeless -- 62 of
//     220 country names had no NE counterpart. iso2 collapses all of it.
//   * Resolution. These polygons are now RENDERED (the eliminated-country tint
//     on the minimap), not just point-tested, so a visible edge that follows
//     the drawn border reasonably closely started to matter.
//
// Features sharing an ISO code (Australia carries three: the mainland plus the
// Ashmore and Coral Sea island territories) are merged into one MultiPolygon,
// so one code maps to exactly one shape.
//
// Simplification is not just about repo size: the tint is fetched per country,
// so what matters most is the biggest SINGLE country's payload. Raw 50m Canada
// is 194KB on its own -- a 10-round game could ship half a megabyte of
// coastline detail to draw a wash the player sees at 15% opacity. Ramer-
// Douglas-Peucker plus a minimum-island filter brings that down by an order of
// magnitude while leaving the shape recognizable at every zoom the minimap
// spends real time at.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const OUT_PATH = path.join(__dirname, '..', 'web', 'data', 'country-shapes.json');
const PRECISION = 3;
// Degrees of perpendicular deviation tolerated when simplifying (~2.2km at the
// equator). Sub-pixel below z8, and by z8 the tint has already faded to a
// whisper -- see ELIMINATED_TINT_LAYER in web/lib/minimapStyle.ts.
const SIMPLIFY_TOLERANCE = 0.02;
// Islands smaller than this (bbox diagonal, degrees ~ 11km) are dropped, except
// for a country's single largest ring -- which is what keeps genuinely tiny
// states (Malta, Bahrain, Singapore) from being erased entirely.
const MIN_ISLAND_DIAGONAL = 0.1;

const round = (n) => Number(n.toFixed(PRECISION));

/** Ramer-Douglas-Peucker, iterative rather than recursive: Canada's outer ring
 * is ~26,000 points and the recursive form blows the stack on it. */
function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;

    let maxDist2 = -1;
    let maxIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let dist2;
      if (len2 === 0) {
        dist2 = (px - x1) ** 2 + (py - y1) ** 2;
      } else {
        // Perpendicular distance to the segment, squared -- no sqrt needed
        // since only the comparison against the tolerance matters.
        const cross = dx * (py - y1) - dy * (px - x1);
        dist2 = (cross * cross) / len2;
      }
      if (dist2 > maxDist2) {
        maxDist2 = dist2;
        maxIndex = i;
      }
    }

    if (maxDist2 > tol2) {
      keep[maxIndex] = 1;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

function ringDiagonal(ring) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return Math.hypot(maxLon - minLon, maxLat - minLat);
}

/** Rounds every coordinate in place, dropping consecutive duplicate points the
 * rounding creates (a ring of identical vertices renders as nothing and
 * point-in-polygon divides by zero on a zero-length edge). */
function roundRing(ring, tolerance = SIMPLIFY_TOLERANCE) {
  const simplified = simplify(ring, tolerance);
  const out = [];
  for (const [lon, lat] of simplified) {
    const p = [round(lon), round(lat)];
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  // Simplification and rounding both open the ring's seam; close it again
  // rather than leaving MapLibre to infer it.
  if (out.length >= 3) {
    const [fx, fy] = out[0];
    const [lx, ly] = out[out.length - 1];
    if (fx !== lx || fy !== ly) out.push([fx, fy]);
  }
  // A closed ring needs at least a triangle to survive.
  return out.length >= 4 ? out : null;
}

/** Drops the polygon's holes along with it if the exterior ring collapsed --
 * a hole with no surrounding shape is meaningless. */
function roundPolygon(rings, keepAtAnyCost = false) {
  // A country smaller than the simplification tolerance itself (Vatican City,
  // Tuvalu) collapses to nothing at 0.02 degrees. For those -- and only those
  // -- fall back to the raw ring: they are a handful of points either way.
  const exterior = roundRing(rings[0]) ?? (keepAtAnyCost ? roundRing(rings[0], 0) : null);
  if (!exterior) return null;
  const holes = rings.slice(1).map(roundRing).filter(Boolean);
  return [exterior, ...holes];
}

/** Every geometry comes out as a MultiPolygon regardless of input type, so
 * merging two features sharing an ISO code is a plain array concat. */
function toRoundedPolygons(geometry) {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  // Rank by size BEFORE simplifying, so "the largest ring" is decided on the
  // real geometry, and a micro-state's only island always survives.
  const ranked = polygons
    .map((rings) => ({ rings, diagonal: ringDiagonal(rings[0]) }))
    .sort((a, b) => b.diagonal - a.diagonal);
  return ranked
    .filter((p, i) => i === 0 || p.diagonal >= MIN_ISLAND_DIAGONAL)
    .map((p, i) => roundPolygon(p.rings, i === 0))
    .filter(Boolean);
}

async function main() {
  process.stdout.write(`fetching ${SOURCE_URL}\n`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const raw = await res.json();

  const byIso = new Map();
  let skipped = 0;
  for (const f of raw.features) {
    const iso2 = f.properties.ISO_A2_EH;
    // Somaliland, Northern Cyprus, and the Siachen Glacier have no ISO code in
    // the source (-99). None of them has a city in the corpus under a name the
    // ETL would give them, so there is nothing to tint.
    if (!iso2 || iso2 === '-99') {
      skipped++;
      continue;
    }
    const polygons = toRoundedPolygons(f.geometry);
    if (polygons.length === 0) continue;
    const existing = byIso.get(iso2);
    if (existing) existing.geometry.coordinates.push(...polygons);
    else {
      byIso.set(iso2, {
        iso2,
        name: f.properties.NAME,
        geometry: { type: 'MultiPolygon', coordinates: polygons },
      });
    }
  }

  const out = [...byIso.values()].sort((a, b) => a.iso2.localeCompare(b.iso2));
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const kb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  process.stdout.write(
    `wrote ${out.length} countries (${skipped} skipped, no ISO code) -> ${OUT_PATH} (${kb}KB)\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
