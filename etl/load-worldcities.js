const fs = require('fs');

function parseCsvLine(line) {
  return line.match(/"([^"]*)"/g).map(s => s.slice(1, -1));
}

function loadWorldCities(path) {
  const txt = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const hdr = parseCsvLine(txt[0]);
  const rows = [];
  for (let i = 1; i < txt.length; i++) {
    const v = parseCsvLine(txt[i]);
    const o = {};
    hdr.forEach((h, j) => o[h] = v[j]);
    rows.push({
      city: o.city, lat: parseFloat(o.lat), lon: parseFloat(o.lng),
      country: o.country, iso2: o.iso2, iso3: o.iso3,
      population: parseInt(o.population, 10) || 0,
    });
  }
  return rows;
}

// Most common iso2 per country name -- used as a fallback when GeoNames
// doesn't supply a country code for a resolved city.
function buildCountryToIso2(worldCitiesRows) {
  const counts = new Map();
  for (const r of worldCitiesRows) {
    if (!r.country || !r.iso2) continue;
    let m = counts.get(r.country);
    if (!m) counts.set(r.country, m = new Map());
    m.set(r.iso2, (m.get(r.iso2) || 0) + 1);
  }
  const out = new Map();
  for (const [country, m] of counts) {
    let bestIso2 = null, bestCount = 0;
    for (const [iso2, c] of m) if (c > bestCount) { bestCount = c; bestIso2 = iso2; }
    out.set(country, bestIso2);
  }
  return out;
}

module.exports = { loadWorldCities, buildCountryToIso2 };
