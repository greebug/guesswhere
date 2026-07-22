const fs = require('fs');
const readline = require('readline');

// cities500.txt columns (GeoNames "geoname" format):
// geonameid, name, asciiname, alternatenames, latitude, longitude, feature_class,
// feature_code, country_code, cc2, admin1, admin2, admin3, admin4, population,
// elevation, dem, timezone, modification_date
async function loadCities500(path) {
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  const byId = new Map();
  for await (const line of rl) {
    if (!line) continue;
    const f = line.split('\t');
    byId.set(f[0], {
      geonameid: f[0], name: f[1], asciiname: f[2],
      lat: parseFloat(f[4]), lon: parseFloat(f[5]),
      countryCode: f[8], population: parseInt(f[14], 10) || 0,
    });
  }
  return byId;
}

// alternateNamesV2.txt columns:
// alternateNameId, geonameid, isolanguage, alternate name, isPreferredName,
// isShortName, isColloquial, isHistoric, from, to
//
// Pass 1: wikidata QID -> geonameid, from the 'wkdt' rows. Tile place features
// carry a wikidata QID, so this is a stronger join key than spatial nearest-
// neighbor and should be tried first.
async function loadWikidataIndex(path) {
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  const wikidataToGeonameId = new Map();
  for await (const line of rl) {
    if (!line) continue;
    const tab1 = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab1 + 1);
    const tab3 = line.indexOf('\t', tab2 + 1);
    const lang = line.slice(tab2 + 1, tab3);
    if (lang !== 'wkdt') continue;
    const geonameid = line.slice(tab1 + 1, tab2);
    const tab4 = line.indexOf('\t', tab3 + 1);
    const name = line.slice(tab3 + 1, tab4 === -1 ? undefined : tab4);
    if (name) wikidataToGeonameId.set(name, geonameid);
  }
  return wikidataToGeonameId;
}

// Pass 2: display-name aliases for a known, already-narrowed set of geonameids
// (call this only after wantedGeonameIds is finalized, to avoid holding
// aliases for all 235k+ GeoNames cities in memory).
async function loadAliasesForGeonameIds(path, wantedGeonameIds) {
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  const byGeonameId = new Map();
  for await (const line of rl) {
    if (!line) continue;
    const f = line.split('\t');
    const geonameid = f[1];
    if (!wantedGeonameIds.has(geonameid)) continue;
    // Non-display isolanguage values: wikidata QIDs, URLs, postal codes, and
    // transport codes (IATA "JKT", UN/LOCODE "CNXGY"). No player types these,
    // and short codes are exactly the kind of token that causes false accepts.
    const lang = f[2];
    if (lang === 'wkdt' || lang === 'link' || lang === 'post' ||
        lang === 'iata' || lang === 'icao' || lang === 'faac' ||
        lang === 'tcid' || lang === 'unlc') continue;
    const isHistoric = f[7] === '1';
    if (isHistoric) continue;
    const name = f[3];
    if (!name) continue;
    let arr = byGeonameId.get(geonameid);
    if (!arr) byGeonameId.set(geonameid, arr = []);
    if (!arr.includes(name)) arr.push(name);
  }
  return byGeonameId;
}

module.exports = { loadCities500, loadWikidataIndex, loadAliasesForGeonameIds };
