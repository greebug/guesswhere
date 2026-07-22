// Independent acceptance check (PLAN.md phase 1): for a random sample of
// playable cities, re-query the tile fresh and confirm a feature matching
// the stored canonical_name genuinely exists near the stored coordinate.
const { DatabaseSync } = require('node:sqlite');
const { TileLabelSource } = require('./tile-query.js');
const { similarity } = require('./name-match.js');

(async () => {
  const db = new DatabaseSync('./cities.sqlite', { readOnly: true });
  const tiles = new TileLabelSource('C:/geodata/planet/planet_z13.pmtiles');

  const countries = ['China', 'India', 'Nigeria', 'Japan', 'Brazil', 'United States',
    'Russian Federation', 'Indonesia', 'Egypt', 'Mexico'];
  const rows = [];
  for (const c of countries) {
    rows.push(...db.prepare(
      'SELECT * FROM cities WHERE quarantined=0 AND country=? ORDER BY RANDOM() LIMIT 2'
    ).all(c));
  }

  let pass = 0, fail = 0;
  for (const r of rows) {
    const nearby = await tiles.findNearbySettlements(r.lat, r.lon, 2);
    const match = nearby.find(f =>
      similarity(f.props.name, r.canonical_name) > 0.8 ||
      similarity(f.props['name:en'] || '', r.canonical_name) > 0.8);
    const ok = !!match;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${r.country.padEnd(20)} ${r.canonical_name.padEnd(20)} min_zoom=${r.min_render_zoom} pop=${r.pop_ghsl}`);
  }
  console.log(`\n${pass}/${pass + fail} passed independent re-verification`);
})().catch(e => console.error(e));
