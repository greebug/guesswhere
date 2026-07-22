// Standalone, idempotent add-on to cities.sqlite -- NOT part of build.js's main
// pipeline. Coastal distance is a pure function of a city's already-resolved
// lat/lon; it doesn't touch GHSL/tile resolution or the answer key at all, so
// there's no need to pay build.js's ~7min tile-resolution cost to add it.
// Safe to re-run: skips the ALTER if the column already exists, and always
// recomputes every row's distance from scratch.
const fs = require('fs');
const https = require('https');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SpatialGrid, haversineKm } = require('./spatial-grid.js');

const COASTLINE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson';
const COASTLINE_DIR = 'C:/geodata/coastline';
const COASTLINE_PATH = path.join(COASTLINE_DIR, 'ne_10m_coastline.geojson');
const CITIES_DB = './cities.sqlite';

// Generous margin above the 20mi (~32.19km) gameplay threshold used in
// web/lib/server/gameLogic.ts -- vertex-nearest is an approximation (see
// CLAUDE.md/plan notes), and a wider search radius here costs nothing since
// this only runs once per rebuild, not per game request.
const SEARCH_RADIUS_KM = 60;

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${url} -> ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureCoastline() {
  if (fs.existsSync(COASTLINE_PATH)) {
    console.log(`Using cached coastline data at ${COASTLINE_PATH}`);
    return;
  }
  fs.mkdirSync(COASTLINE_DIR, { recursive: true });
  console.log(`Downloading ${COASTLINE_URL} ...`);
  await download(COASTLINE_URL, COASTLINE_PATH);
  console.log(' -> done');
}

function buildCoastlineGrid() {
  const geojson = JSON.parse(fs.readFileSync(COASTLINE_PATH, 'utf8'));
  const grid = new SpatialGrid(1);
  let vertexCount = 0;

  const addLine = (coords) => {
    for (const [lon, lat] of coords) {
      grid.insert(lat, lon, true);
      vertexCount++;
    }
  };

  for (const feature of geojson.features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === 'LineString') addLine(g.coordinates);
    else if (g.type === 'MultiLineString') for (const line of g.coordinates) addLine(line);
  }

  console.log(`Coastline grid: ${vertexCount} vertices from ${geojson.features.length} features`);
  return grid;
}

async function main() {
  await ensureCoastline();
  const grid = buildCoastlineGrid();

  const db = new DatabaseSync(CITIES_DB);
  const cols = db.prepare('PRAGMA table_info(cities)').all();
  if (!cols.some((c) => c.name === 'dist_to_coast_km')) {
    console.log('Adding dist_to_coast_km column...');
    db.exec('ALTER TABLE cities ADD COLUMN dist_to_coast_km REAL');
  }

  const rows = db
    .prepare('SELECT id, lat, lon FROM cities WHERE quarantined = 0')
    .all();
  console.log(`Computing coastal distance for ${rows.length} cities...`);

  const update = db.prepare('UPDATE cities SET dist_to_coast_km = ? WHERE id = ?');
  db.exec('BEGIN');
  let unresolved = 0;
  for (const r of rows) {
    const nearest = grid.nearest(r.lat, r.lon, SEARCH_RADIUS_KM);
    if (!nearest) {
      // Should only happen for a point genuinely >60km from the nearest
      // coastline vertex the grid knows about -- leave null rather than
      // guess, so the onlyCoast filter correctly excludes it.
      unresolved++;
      continue;
    }
    update.run(nearest.distKm, r.id);
  }
  db.exec('COMMIT');
  db.close();

  console.log(`Done. ${rows.length - unresolved} rows updated, ${unresolved} left null (>${SEARCH_RADIUS_KM}km from any known vertex).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
