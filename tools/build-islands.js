#!/usr/bin/env node
// Regenerates web/public/islands.json -- a marker point for every small,
// isolated island, so they can be spotted on the minimap from a world view.
//
//   node tools/build-islands.js
//
// Why this exists: a real island can be a single pixel at z2, and a player
// hunting for (say) Guam has no way to tell open Pacific from open Pacific
// with an island in it. The vector tileset draws the island's true shape, and
// its true shape at that zoom is nothing. This layer draws a faint ring at
// each one instead -- an "there is land here" marker, deliberately with no
// name attached (naming islands would edge into the answer key, which by
// project invariant comes from the minimap tiles and nowhere else).
//
// Input: C:\geodata\coastline\ne_10m_coastline.geojson -- Natural Earth 10m
// coastline (public domain), already downloaded for etl/add-coastal-distance.js.
// It is a set of LineStrings; a CLOSED one is an island's outline, an open one
// is a continental coast segment cut at the data's edges.
//
// Two filters decide what gets a marker, and both matter:
//   * size    -- only islands too small to read at low zoom. Anything bigger
//                already draws its own recognizable shape.
//   * isolation -- only islands well away from a major landmass. Without this
//                the Greek, Norwegian, Croatian and Canadian-arctic coasts
//                turn into a solid mass of markers, which is noise, not a
//                hint. What the player actually can't find is an island alone
//                in an ocean.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PATH = 'C:\\geodata\\coastline\\ne_10m_coastline.geojson';
const OUT_PATH = path.join(__dirname, '..', 'web', 'public', 'islands.json');

// Islands whose longest dimension exceeds this draw a shape you can see and
// identify unaided (Sicily, Hokkaido, Iceland) -- no marker needed.
const MAX_SPAN_KM = 300;
// Below this, a "ring" is a rock or sandbar with nothing on it. It also cuts
// the marker count roughly in half.
const MIN_SPAN_KM = 2;
// A landmass this big is what an island is measured as "near" or "far" from.
const MAINLAND_SPAN_KM = 400;
// Closer than this to a mainland and the island is findable by following the
// coast, which is how people actually navigate a map.
const MIN_ISOLATION_KM = 150;

const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;

function ringMetrics(coords) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const lat = (minLat + maxLat) / 2;
  const widthKm = (maxLon - minLon) * KM_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
  const heightKm = (maxLat - minLat) * KM_PER_DEG_LAT;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return {
    coords,
    closed: first[0] === last[0] && first[1] === last[1],
    lon: (minLon + maxLon) / 2,
    lat,
    span: Math.max(widthKm, heightKm),
  };
}

/** Distance from a point to the nearest vertex of a ring. Vertex distance, not
 * true segment distance -- 10m coastline vertices are a few km apart at most,
 * which is noise against a 150km isolation threshold. Long rings are sampled
 * so the whole sweep stays a few seconds rather than a few minutes. */
function distanceToRingKm(lon, lat, ring) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const step = Math.max(1, Math.floor(ring.coords.length / 4000));
  let best = Infinity;
  for (let i = 0; i < ring.coords.length; i += step) {
    const [x, y] = ring.coords[i];
    let dLon = x - lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const d = Math.hypot(dLon * KM_PER_DEG_LON * cosLat, (y - lat) * KM_PER_DEG_LAT);
    if (d < best) best = d;
  }
  return best;
}

function main() {
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(
      `${SOURCE_PATH} not found -- download Natural Earth's 10m coastline into C:\\geodata\\coastline\\ first`
    );
  }
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const rings = source.features.map((f) => ringMetrics(f.geometry.coordinates));

  const mainlands = rings.filter((r) => r.span > MAINLAND_SPAN_KM);
  const candidates = rings.filter(
    (r) => r.closed && r.span >= MIN_SPAN_KM && r.span <= MAX_SPAN_KM
  );

  const kept = candidates.filter((island) =>
    mainlands.every((m) => distanceToRingKm(island.lon, island.lat, m) >= MIN_ISOLATION_KM)
  );

  const geojson = {
    type: 'FeatureCollection',
    features: kept.map((i) => ({
      type: 'Feature',
      properties: { span: Math.round(i.span) },
      geometry: { type: 'Point', coordinates: [Number(i.lon.toFixed(3)), Number(i.lat.toFixed(3))] },
    })),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(geojson));
  const kb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  process.stdout.write(
    `${mainlands.length} mainlands, ${candidates.length} candidate islands, ` +
      `${kept.length} isolated -> ${OUT_PATH} (${kb}KB)\n`
  );
}

main();
