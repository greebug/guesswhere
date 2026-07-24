const { DatabaseSync } = require('node:sqlite');
const { loadGHSL } = require('./load-ghsl.js');
const { TileLabelSource } = require('./tile-query.js');
const { bestNameFieldScore } = require('./name-match.js');
const { loadCities500, loadWikidataIndex, loadAliasesForGeonameIds } = require('./load-geonames.js');
const { loadWorldCities, buildCountryToIso2 } = require('./load-worldcities.js');
const { SpatialGrid, haversineKm } = require('./spatial-grid.js');

const PLANET_PMTILES = 'C:/geodata/planet/planet_z13.pmtiles';
const GHSL_GPKG = 'C:/geodata/ghsl/extracted/GHS_UCDB_GLOBE_R2024A.gpkg';
const GEONAMES_ALTNAMES = 'C:/geodata/geonames/extracted/alternateNamesV2.txt';
const GEONAMES_CITIES500 = 'C:/geodata/geonames/extracted/cities500.txt';
const WORLDCITIES_CSV = '../worldcities.csv';
const OUT_SQLITE = './cities.sqlite';

const GEONAMES_MATCH_RADIUS_KM = 30;
const WORLDCITIES_CROSSCHECK_RADIUS_KM = 30;
const NAME_SCORE_THRESHOLD = 0.5;
const GEONAMES_COVERAGE_MIN_POP = 30000;
// A GHSL urban centre this small still gets a >=25km tile-search radius (the
// floor in radiusForArea, below) -- that's deliberately generous for finding
// a matching OSM label, but far too generous for "is this GeoNames candidate
// already inside that city's built-up footprint". Real Perm (~1M people) is
// only ~5km from a small 7km2 GHSL satellite-village entry near it, and
// radiusForArea's 25km floor would wrongly treat Perm as already counted.
// This uses the polygon's own physical size instead, no artificial floor.
function physicalRadiusKm(areaKm2) {
  return Math.sqrt(areaKm2 / Math.PI) * 1.3;
}
// GeoNames candidates have no polygon area (just a point + population), so
// estimate one for both the tile-search radius and this city's own future
// dedup shadow, assuming a plausible built-up density.
function estimatedAreaKm2FromPopulation(pop) {
  return pop / 2500;
}

function radiusForArea(areaKm2) {
  return Math.min(75, Math.max(25, Math.sqrt(areaKm2 / Math.PI) * 2.5));
}

async function resolveAgainstTiles(tiles, ghslCity) {
  if (!ghslCity.name) {
    return { status: 'QUARANTINE_NO_GHSL_NAME', reason: 'GHSL urban centre has no main name' };
  }
  const radiusKm = radiusForArea(ghslCity.areaKm2);
  const candidates = await tiles.findNearbySettlements(ghslCity.lat, ghslCity.lon, radiusKm);
  if (!candidates.length) {
    return { status: 'QUARANTINE_NO_CANDIDATES', reason: `no settlement-kind places within ${radiusKm.toFixed(0)}km` };
  }
  for (const c of candidates) {
    c.mainScore = bestNameFieldScore(c.props, ghslCity.name);
    c.listScore = bestNameFieldScore(c.props, ghslCity.nameList || ghslCity.name);
    // GHSL's main name is sometimes a compound/bracketed form, e.g.
    // "Minneapolis [Saint Paul]" or "Colombo [Sri Jayawardenepura Kotte]".
    // Scored as one whole string, a true candidate that only matches half
    // the compound (e.g. "Minneapolis") loses to an unrelated but
    // coincidentally similar-length nearby place. bestScore -- the same
    // combined metric already used for the quarantine threshold below --
    // must drive candidate selection too, not just gate it after the fact.
    c.bestScore = Math.max(c.mainScore, c.listScore);
  }
  candidates.sort((a, b) =>
    (b.bestScore - a.bestScore) ||
    (b.mainScore - a.mainScore) ||
    (b.listScore - a.listScore) ||
    ((b.props.population_rank || 0) - (a.props.population_rank || 0)) ||
    (a.distKm - b.distKm));

  const best = candidates[0];
  const nameScore = Math.max(best.mainScore, best.listScore);
  if (nameScore < NAME_SCORE_THRESHOLD) {
    return {
      status: 'QUARANTINE_NO_NAME_MATCH',
      reason: `best candidate "${best.props.name}" scored ${nameScore.toFixed(2)} against GHSL name "${ghslCity.name}"`,
    };
  }
  return { status: 'OK', best, nameScore, radiusKm, candidateCount: candidates.length };
}

async function main() {
  console.log('Loading GHSL urban centres...');
  const ghslCities = loadGHSL(GHSL_GPKG);
  console.log(` -> ${ghslCities.length} urban centres`);

  console.log('Loading worldcities.csv for country/iso2 + cross-check...');
  const worldCities = loadWorldCities(WORLDCITIES_CSV);
  const countryToIso2 = buildCountryToIso2(worldCities);
  // Inverse of the above -- GeoNames-sourced rows (Part B) carry an iso2
  // straight from cities500.txt and need the display country name back.
  const iso2ToCountry = new Map();
  {
    const counts = new Map();
    for (const r of worldCities) {
      if (!r.country || !r.iso2) continue;
      let m = counts.get(r.iso2);
      if (!m) counts.set(r.iso2, m = new Map());
      m.set(r.country, (m.get(r.country) || 0) + 1);
    }
    for (const [iso2, m] of counts) {
      let bestCountry = null, bestCount = 0;
      for (const [country, c] of m) if (c > bestCount) { bestCount = c; bestCountry = country; }
      iso2ToCountry.set(iso2, bestCountry);
    }
  }
  const worldCitiesGrid = new SpatialGrid(1);
  for (const r of worldCities) worldCitiesGrid.insert(r.lat, r.lon, r);
  console.log(` -> ${worldCities.length} rows, ${countryToIso2.size} countries mapped to iso2`);

  console.log('Loading GeoNames cities500 (for alias spatial join)...');
  const cities500ById = await loadCities500(GEONAMES_CITIES500);
  const cities500Grid = new SpatialGrid(1);
  for (const [id, c] of cities500ById) cities500Grid.insert(c.lat, c.lon, { id, ...c });
  console.log(` -> ${cities500ById.size} cities`);

  console.log('Loading GeoNames wikidata index (single pass over alternateNamesV2.txt)...');
  const wikidataToGeonameId = await loadWikidataIndex(GEONAMES_ALTNAMES);
  console.log(` -> ${wikidataToGeonameId.size} wikidata QIDs indexed`);

  console.log('Resolving GHSL urban centres against minimap tiles...');
  const tiles = new TileLabelSource(PLANET_PMTILES);
  const resolved = [];
  let okCount = 0;
  const t0 = Date.now();
  for (let i = 0; i < ghslCities.length; i++) {
    const g = ghslCities[i];
    const r = await resolveAgainstTiles(tiles, g);
    if (r.status === 'OK') okCount++;
    resolved.push({ ghsl: g, resolution: r });
    if ((i + 1) % 1000 === 0) {
      console.log(`  ${i + 1}/${ghslCities.length} (${okCount} OK, ${(Date.now() - t0) / 1000 | 0}s elapsed)`);
    }
  }
  console.log(`Resolution done: ${okCount}/${ghslCities.length} OK (${(100 * okCount / ghslCities.length).toFixed(1)}%)`);

  // Determine which GeoNames geonameid each OK city joins to, so the alias
  // pass only has to hold aliases for cities we actually kept.
  console.log('Joining resolved cities to GeoNames (wikidata exact, else spatial)...');
  const wantedGeonameIds = new Set();
  for (const row of resolved) {
    if (row.resolution.status !== 'OK') continue;
    const wikidata = row.resolution.best.props.wikidata;
    let geonameid = wikidata ? wikidataToGeonameId.get(wikidata) : undefined;
    let joinMethod = geonameid ? 'wikidata' : null;
    if (!geonameid) {
      const nearest = cities500Grid.nearest(row.resolution.best.lat, row.resolution.best.lon, GEONAMES_MATCH_RADIUS_KM);
      if (nearest) { geonameid = nearest.item.id; joinMethod = 'spatial'; }
    }
    row.geonameid = geonameid || null;
    row.geonamesJoinMethod = joinMethod;
    if (geonameid) wantedGeonameIds.add(geonameid);
  }
  console.log(` -> ${wantedGeonameIds.size} distinct GeoNames cities to fetch aliases for`);

  // Part B: towns below GHSL's own density/contiguity bar for an "urban
  // centre" (real, sizeable places like Missoula or Kalamata that GHSL's
  // Urban Centre Database never generated a row for at all -- confirmed by
  // direct query, not a filter of ours). Source: GeoNames cities500.txt,
  // already loaded above for alias joining. A candidate is skipped if it's
  // already the GeoNames join target of an accepted GHSL city (same place,
  // already counted) or if it falls within the *physical* radius of an
  // already-accepted city (GHSL or a bigger already-accepted GeoNames town
  // processed earlier) -- i.e. plausibly already inside that city's built-up
  // footprint, so counting it separately would double-count population.
  console.log('Selecting GeoNames coverage candidates (towns below GHSL\'s own threshold)...');
  const acceptedGrid = new SpatialGrid(1);
  for (const row of resolved) {
    if (row.resolution.status !== 'OK') continue;
    acceptedGrid.insert(row.resolution.best.lat, row.resolution.best.lon, { areaKm2: row.ghsl.areaKm2 });
  }
  const geonamesCandidates = [];
  const geonamesPool = [...cities500ById.values()]
    .filter(c => c.population >= GEONAMES_COVERAGE_MIN_POP)
    .sort((a, b) => b.population - a.population);
  for (const c of geonamesPool) {
    if (wantedGeonameIds.has(c.geonameid)) continue; // already the join target of an accepted GHSL city
    const nearest = acceptedGrid.nearest(c.lat, c.lon, 100);
    if (nearest && nearest.distKm <= physicalRadiusKm(nearest.item.areaKm2)) continue; // already counted
    const areaKm2 = estimatedAreaKm2FromPopulation(c.population);
    acceptedGrid.insert(c.lat, c.lon, { areaKm2 });
    geonamesCandidates.push({ ...c, areaKm2 });
    wantedGeonameIds.add(c.geonameid); // so the alias pass below covers it too
  }
  console.log(` -> ${geonamesPool.length} candidates >= ${GEONAMES_COVERAGE_MIN_POP} population, ${geonamesCandidates.length} survive dedup`);

  console.log('Loading aliases for resolved cities (second pass over alternateNamesV2.txt)...');
  const aliasesByGeonameId = await loadAliasesForGeonameIds(GEONAMES_ALTNAMES, wantedGeonameIds);
  console.log(` -> aliases loaded for ${aliasesByGeonameId.size} cities`);

  console.log('Assembling final rows + worldcities.csv cross-check...');
  const finalRows = [];
  for (const row of resolved) {
    const g = row.ghsl;
    if (row.resolution.status !== 'OK') {
      finalRows.push({
        id: g.id, canonical_name: null, aliases: [], lat: null, lon: null,
        country: g.country, iso2: countryToIso2.get(g.country) || null,
        pop_ghsl: g.pop, min_render_zoom: null, wikidata: null,
        quarantined: 1, quarantine_reason: row.resolution.reason,
        crosscheck_note: null, pop_source: 'ghsl',
      });
      continue;
    }
    const best = row.resolution.best;
    const canonicalName = best.props['name:en'] || best.props.name;

    const aliasSet = new Set();
    // Every name:* field on the tile feature -- these are the strongest alias
    // source available, since they're attached to the exact feature the
    // minimap renders. Skip pgf:* (pre-rendered glyph fields, often empty).
    for (const [k, v] of Object.entries(best.props)) {
      if (!v || typeof v !== 'string') continue;
      if (k === 'name' || (k.startsWith('name:') && !k.startsWith('pgf:'))) aliasSet.add(v);
    }
    // GHSL's main name for this urban centre. Deliberately NOT nameList --
    // that lists absorbed *neighbouring* settlements (Kolkata's includes
    // "Howrah", Beijing's includes "Chaoyang"), which are different places
    // and would make the grader accept wrong answers.
    if (g.name) aliasSet.add(g.name);
    if (row.geonameid) {
      const geo = cities500ById.get(row.geonameid);
      if (geo) { aliasSet.add(geo.name); aliasSet.add(geo.asciiname); }
      for (const a of (aliasesByGeonameId.get(row.geonameid) || [])) aliasSet.add(a);
    }
    aliasSet.delete(canonicalName);

    // Cross-check: does worldcities.csv have a nearby entry with wildly
    // different population? Flag only -- never auto-exclude (PLAN.md).
    let crosscheckNote = null;
    const nearestWC = worldCitiesGrid.nearest(best.lat, best.lon, WORLDCITIES_CROSSCHECK_RADIUS_KM);
    if (!nearestWC) {
      crosscheckNote = 'no worldcities.csv entry within 30km';
    } else if (nearestWC.item.population > 0) {
      const ratio = g.pop / nearestWC.item.population;
      if (ratio > 3 || ratio < 1 / 3) {
        crosscheckNote = `worldcities.csv "${nearestWC.item.city}" pop=${nearestWC.item.population} vs GHSL pop=${g.pop} (${ratio.toFixed(1)}x)`;
      }
    }

    finalRows.push({
      id: g.id, canonical_name: canonicalName, aliases: [...aliasSet],
      lat: best.lat, lon: best.lon,
      country: g.country, iso2: countryToIso2.get(g.country) || cities500ById.get(row.geonameid)?.countryCode || null,
      pop_ghsl: g.pop, min_render_zoom: best.props.min_zoom ?? null, wikidata: best.props.wikidata || null,
      quarantined: 0, quarantine_reason: null,
      crosscheck_note: crosscheckNote, pop_source: 'ghsl',
    });
  }

  console.log('Resolving GeoNames coverage candidates against minimap tiles...');
  // TileLabelSource's tileCache never evicts -- after 11k+ GHSL lookups it's
  // already sitting close to the heap ceiling (confirmed: an OOM crash landed
  // right at this step). This second sweep touches a mostly-disjoint set of
  // tiles (globally scattered small towns), so starting it with a clean
  // cache avoids compounding on top of the first pass's memory footprint.
  tiles.tileCache.clear();
  // GeoNames ids run up to ~12M; offset well clear of both that range and any
  // GHSL ID_UC_G0 so the two id spaces can never collide.
  const GEONAMES_ID_OFFSET = 100000000;
  let geonamesOkCount = 0;
  for (const c of geonamesCandidates) {
    const r = await resolveAgainstTiles(tiles, { name: c.name, areaKm2: c.areaKm2, lat: c.lat, lon: c.lon });
    const id = GEONAMES_ID_OFFSET + parseInt(c.geonameid, 10);
    if (r.status !== 'OK') {
      finalRows.push({
        id, canonical_name: null, aliases: [], lat: null, lon: null,
        country: iso2ToCountry.get(c.countryCode) || null, iso2: c.countryCode || null,
        pop_ghsl: c.population, min_render_zoom: null, wikidata: null,
        quarantined: 1, quarantine_reason: r.reason,
        crosscheck_note: null, pop_source: 'geonames',
      });
      continue;
    }
    geonamesOkCount++;
    const best = r.best;
    const canonicalName = best.props['name:en'] || best.props.name;

    const aliasSet = new Set();
    for (const [k, v] of Object.entries(best.props)) {
      if (!v || typeof v !== 'string') continue;
      if (k === 'name' || (k.startsWith('name:') && !k.startsWith('pgf:'))) aliasSet.add(v);
    }
    aliasSet.add(c.name);
    aliasSet.add(c.asciiname);
    for (const a of (aliasesByGeonameId.get(c.geonameid) || [])) aliasSet.add(a);
    aliasSet.delete(canonicalName);

    let crosscheckNote = null;
    const nearestWC = worldCitiesGrid.nearest(best.lat, best.lon, WORLDCITIES_CROSSCHECK_RADIUS_KM);
    if (!nearestWC) {
      crosscheckNote = 'no worldcities.csv entry within 30km';
    } else if (nearestWC.item.population > 0) {
      const ratio = c.population / nearestWC.item.population;
      if (ratio > 3 || ratio < 1 / 3) {
        crosscheckNote = `worldcities.csv "${nearestWC.item.city}" pop=${nearestWC.item.population} vs GeoNames pop=${c.population} (${ratio.toFixed(1)}x)`;
      }
    }

    finalRows.push({
      id, canonical_name: canonicalName, aliases: [...aliasSet],
      lat: best.lat, lon: best.lon,
      country: iso2ToCountry.get(c.countryCode) || null, iso2: c.countryCode || null,
      pop_ghsl: c.population, min_render_zoom: best.props.min_zoom ?? null, wikidata: best.props.wikidata || null,
      quarantined: 0, quarantine_reason: null,
      crosscheck_note: crosscheckNote, pop_source: 'geonames',
    });
  }
  console.log(` -> ${geonamesOkCount}/${geonamesCandidates.length} GeoNames candidates resolved OK`);

  console.log('Writing cities.sqlite...');
  const fs = require('fs');
  if (fs.existsSync(OUT_SQLITE)) fs.unlinkSync(OUT_SQLITE);
  const db = new DatabaseSync(OUT_SQLITE);
  db.exec(`
    CREATE TABLE cities (
      id INTEGER PRIMARY KEY,
      canonical_name TEXT,
      aliases_json TEXT,
      lat REAL,
      lon REAL,
      country TEXT,
      iso2 TEXT,
      pop_ghsl INTEGER,
      min_render_zoom INTEGER,
      wikidata TEXT,
      quarantined INTEGER NOT NULL,
      quarantine_reason TEXT,
      crosscheck_note TEXT,
      pop_source TEXT
    );
    CREATE INDEX idx_cities_pop ON cities(pop_ghsl);
    CREATE INDEX idx_cities_country ON cities(country);
    CREATE INDEX idx_cities_quarantined ON cities(quarantined);
  `);
  const insert = db.prepare(`
    INSERT INTO cities (id, canonical_name, aliases_json, lat, lon, country, iso2,
      pop_ghsl, min_render_zoom, wikidata, quarantined, quarantine_reason, crosscheck_note, pop_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  for (const r of finalRows) {
    insert.run(r.id, r.canonical_name, JSON.stringify(r.aliases), r.lat, r.lon,
      r.country, r.iso2, r.pop_ghsl, r.min_render_zoom, r.wikidata,
      r.quarantined, r.quarantine_reason, r.crosscheck_note, r.pop_source);
  }
  db.exec('COMMIT');
  db.close();

  const playable = finalRows.filter(r => !r.quarantined).length;
  const geonamesPlayable = finalRows.filter(r => !r.quarantined && r.pop_source === 'geonames').length;
  console.log(`\nDone. ${finalRows.length} total rows, ${playable} playable, ${finalRows.length - playable} quarantined.`);
  console.log(`  of which from GeoNames coverage layer: ${geonamesPlayable} playable / ${finalRows.filter(r => r.pop_source === 'geonames').length} total`);
  console.log(`Cross-check flags: ${finalRows.filter(r => r.crosscheck_note).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
