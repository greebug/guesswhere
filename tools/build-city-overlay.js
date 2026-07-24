// Regenerates tools/city-overlay.html from etl/cities.sqlite.
// Run: node tools/build-city-overlay.js
// Re-run after any edit to cities.sqlite (e.g. the Coyah/Conakry fix) to keep
// the visualization in sync with the answer key.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'etl', 'cities.sqlite');
const outPath = path.join(__dirname, 'city-overlay.html');

const db = new DatabaseSync(dbPath);
const rows = db.prepare(
  'SELECT id, canonical_name, lat, lon, country, iso2, pop_ghsl, quarantined, quarantine_reason, crosscheck_note, dist_to_coast_km FROM cities'
).all();
db.close();

// Tuple rows, not objects -- keeps the embedded payload well under half the
// size an array-of-objects would need. Order must match unpack() in the HTML.
const tuples = rows.map((r) => [
  r.id,
  r.canonical_name,
  Math.round(r.lat * 10000) / 10000,
  Math.round(r.lon * 10000) / 10000,
  r.country,
  r.iso2,
  r.pop_ghsl,
  r.quarantined,
  r.quarantine_reason,
  r.crosscheck_note,
  r.dist_to_coast_km == null ? null : Math.round(r.dist_to_coast_km * 10) / 10,
]);

const dataJson = JSON.stringify(tuples);

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>City overlay: population circles / data-quality flags</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.js"></script>
<style>
  html, body { margin: 0; height: 100%; background: #14161a; color: #e6e8ec; font: 13px/1.4 system-ui, sans-serif; overflow: hidden; }
  .bar {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    padding: 10px 12px; background: rgba(20, 22, 26, 0.92); border-bottom: 1px solid #3a4150;
  }
  .bar .group { display: flex; gap: 6px; align-items: center; }
  .bar label { color: #9aa3b2; }
  select, input, button {
    font: inherit; background: #22262e; color: #e6e8ec; border: 1px solid #3a4150;
    border-radius: 5px; padding: 5px 8px;
  }
  input[type="number"] { width: 64px; }
  input#tok { width: 260px; }
  input#search { width: 180px; }
  button { cursor: pointer; }
  button:hover { background: #2a2f38; }
  button:disabled { opacity: 0.4; cursor: default; }
  button:disabled:hover { background: #22262e; }
  .sep { width: 1px; align-self: stretch; background: #3a4150; margin: 0 2px; }
  #map { position: absolute; inset: 0; }
  #count { color: #9aa3b2; }
  #token-gate {
    position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
    background: #14161a; flex-direction: column; gap: 10px;
  }
  #token-gate.hidden { display: none; }
  #token-gate p { color: #9aa3b2; max-width: 420px; text-align: center; margin: 0 0 4px; }
  #legend {
    position: absolute; left: 10px; bottom: 10px; z-index: 15;
    background: rgba(20, 22, 26, 0.88); border: 1px solid #3a4150; border-radius: 6px;
    padding: 8px 10px; font-size: 12px; color: #cfd3db;
  }
  #legend .row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
  #legend .dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; border: 1.5px solid rgba(255,255,255,0.5); }
  #review {
    position: absolute; right: 10px; top: 54px; z-index: 15; width: 300px;
    background: rgba(20, 22, 26, 0.92); border: 1px solid #3a4150; border-radius: 6px;
    padding: 10px 12px; display: none;
  }
  #review.visible { display: block; }
  #review h3 { margin: 0 0 6px; font-size: 14px; }
  #review .field { margin: 3px 0; }
  #review .field b { color: #9aa3b2; font-weight: 500; }
  #review a { color: #8fb8e6; }
  .mapboxgl-popup-content { background: #1c1f26; color: #e6e8ec; font: 13px/1.5 system-ui, sans-serif; }
  .mapboxgl-popup-content a { color: #8fb8e6; }
  .mapboxgl-popup-tip { border-top-color: #1c1f26 !important; border-bottom-color: #1c1f26 !important; }
</style>
</head>
<body>

<div id="token-gate">
  <p><strong>City overlay</strong> — every city in <code>cities.sqlite</code> as a circle sized
  by population, positioned at its real lat/lon, colored by data-quality flag. Pan/zoom the live
  basemap to spot-check whether a circle's size or position looks wrong (e.g. a real city missing,
  or a small town carrying an inflated population -- the Coyah/Conakry bug that started this tool).</p>
  <p>Paste a Mapbox token to start (kept only in this browser's local storage; shared with box-overlay.html).</p>
  <input type="text" id="tok" placeholder="pk.eyJ1...">
  <button id="go">Load map</button>
</div>

<div class="bar" style="display: none" id="bar">
  <div class="group">
    <label>style</label>
    <select id="style">
      <option value="mapbox://styles/mapbox/satellite-streets-v12">Satellite + labels</option>
      <option value="mapbox://styles/mapbox/satellite-v9">Satellite only</option>
      <option value="mapbox://styles/mapbox/streets-v12">Streets only</option>
    </select>
  </div>
  <div class="sep"></div>
  <div class="group"><input type="checkbox" id="fFlagged"><label for="fFlagged">flagged only</label></div>
  <div class="group"><input type="checkbox" id="fQuarantined"><label for="fQuarantined">quarantined only</label></div>
  <div class="group"><label>min ratio</label><input type="number" id="fRatio" min="0" step="1" value="0" title="Minimum crosscheck ratio (x), e.g. 20 for the 20x+ list"></div>
  <div class="group"><label>min pop</label><input type="number" id="fPop" min="0" step="1000" value="0"></div>
  <span id="count"></span>
  <div class="sep"></div>
  <div class="group">
    <input type="text" id="search" placeholder="jump to city name...">
    <button id="searchGo">Go</button>
  </div>
  <div class="sep"></div>
  <div class="group">
    <button id="prevFlag" title="Previous city in the filtered list">← prev</button>
    <span id="reviewPos" style="color:#9aa3b2">–</span>
    <button id="nextFlag" title="Next city in the filtered list">next →</button>
  </div>
</div>

<div id="map"></div>
<div id="legend">
  <div class="row"><span class="dot" style="background:#5aa0ff"></span> clean</div>
  <div class="row"><span class="dot" style="background:#ffe066"></span> flagged, &lt;20x</div>
  <div class="row"><span class="dot" style="background:#ffb454"></span> flagged, 20–50x</div>
  <div class="row"><span class="dot" style="background:#ff7a1a"></span> flagged, ≥50x</div>
  <div class="row"><span class="dot" style="background:#ff4d4d"></span> quarantined</div>
</div>
<div id="review"></div>

<script>
const CITY_TUPLES = ${dataJson};
// Tuple order matches build-city-overlay.js's SELECT/tuple mapping exactly.
function unpack(t) {
  const [id, name, lat, lon, country, iso2, pop, quarantined, qreason, crosscheck, coastKm] = t;
  let ratio = null;
  if (crosscheck) {
    const m = crosscheck.match(/\\(([\\d.]+)x\\)/);
    if (m) ratio = parseFloat(m[1]);
  }
  return { id, name, lat, lon, country, iso2, pop, quarantined: !!quarantined, qreason, crosscheck, ratio, coastKm };
}
const CITIES = CITY_TUPLES.map(unpack);

function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + iso2.charCodeAt(0) - 65, A + iso2.charCodeAt(1) - 65);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toFeature(c) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
    properties: {
      id: c.id, name: c.name, country: c.country, iso2: c.iso2, pop: c.pop,
      quarantined: c.quarantined ? 1 : 0, qreason: c.qreason || '', crosscheck: c.crosscheck || '',
      ratio: c.ratio == null ? -1 : c.ratio, coastKm: c.coastKm == null ? -1 : c.coastKm,
    },
  };
}
const ALL_GEOJSON = { type: 'FeatureCollection', features: CITIES.map(toFeature) };

const tokKey = 'box-overlay-token'; // shared with tools/box-overlay.html on purpose
const stateKey = 'city-overlay-state-v1';
const savedTok = localStorage.getItem(tokKey);
if (savedTok) document.getElementById('tok').value = savedTok;
document.getElementById('go').onclick = init;
document.getElementById('tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') init(); });
if (savedTok) init();

function init() {
  const token = document.getElementById('tok').value.trim();
  if (!token) return;
  localStorage.setItem(tokKey, token);
  mapboxgl.accessToken = token;

  const saved = JSON.parse(localStorage.getItem(stateKey) || 'null');
  document.getElementById('token-gate').classList.add('hidden');
  document.getElementById('bar').style.display = 'flex';

  const styleSel = document.getElementById('style');
  const fFlagged = document.getElementById('fFlagged');
  const fQuarantined = document.getElementById('fQuarantined');
  const fRatio = document.getElementById('fRatio');
  const fPop = document.getElementById('fPop');
  const searchInput = document.getElementById('search');
  const countEl = document.getElementById('count');
  const reviewEl = document.getElementById('review');
  const reviewPos = document.getElementById('reviewPos');

  if (saved) {
    styleSel.value = saved.style || styleSel.value;
    fFlagged.checked = !!saved.fFlagged;
    fQuarantined.checked = !!saved.fQuarantined;
    fRatio.value = saved.fRatio != null ? saved.fRatio : 0;
    fPop.value = saved.fPop != null ? saved.fPop : 0;
  }

  const map = new mapboxgl.Map({
    container: 'map',
    style: styleSel.value,
    center: saved && saved.center ? saved.center : [0, 20],
    zoom: saved && saved.zoom != null ? saved.zoom : 2,
    attributionControl: true,
  });

  let reviewList = [];
  let reviewIdx = -1;

  function persist() {
    const c = map.getCenter();
    localStorage.setItem(stateKey, JSON.stringify({
      style: styleSel.value, fFlagged: fFlagged.checked, fQuarantined: fQuarantined.checked,
      fRatio: fRatio.value, fPop: fPop.value, center: [c.lng, c.lat], zoom: map.getZoom(),
    }));
  }

  function currentFilter() {
    const clauses = [];
    if (fQuarantined.checked) clauses.push(['==', ['get', 'quarantined'], 1]);
    if (fFlagged.checked) clauses.push(['!=', ['get', 'crosscheck'], '']);
    const minRatio = parseFloat(fRatio.value) || 0;
    if (minRatio > 0) clauses.push(['>=', ['get', 'ratio'], minRatio]);
    const minPop = parseFloat(fPop.value) || 0;
    if (minPop > 0) clauses.push(['>=', ['get', 'pop'], minPop]);
    return clauses.length ? ['all', ...clauses] : null;
  }

  function passesFilter(c) {
    if (fQuarantined.checked && !c.quarantined) return false;
    if (fFlagged.checked && !c.crosscheck) return false;
    const minRatio = parseFloat(fRatio.value) || 0;
    if (minRatio > 0 && (c.ratio == null || c.ratio < minRatio)) return false;
    const minPop = parseFloat(fPop.value) || 0;
    if (minPop > 0 && c.pop < minPop) return false;
    return true;
  }

  function applyFilters() {
    const expr = currentFilter();
    if (map.getLayer('cities-circle')) map.setFilter('cities-circle', expr);
    if (map.getLayer('cities-label')) map.setFilter('cities-label', expr);
    reviewList = CITIES.filter(passesFilter).sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
    reviewIdx = -1;
    reviewPos.textContent = reviewList.length ? ('0 / ' + reviewList.length) : '–';
    countEl.textContent = reviewList.length + ' / ' + CITIES.length + ' cities shown';
    reviewEl.classList.remove('visible');
    persist();
  }

  function showReviewCard(c) {
    reviewEl.classList.add('visible');
    reviewEl.innerHTML =
      '<h3>' + flagEmoji(c.iso2) + ' ' + esc(c.name) + ', ' + esc(c.country) + '</h3>' +
      '<div class="field"><b>Population:</b> ' + c.pop.toLocaleString() + '</div>' +
      (c.crosscheck ? '<div class="field"><b>Crosscheck:</b> ' + esc(c.crosscheck) + '</div>' : '') +
      (c.quarantined ? '<div class="field" style="color:#ff9a9a"><b>Quarantined:</b> ' + esc(c.qreason || '') + '</div>' : '') +
      '<div class="field"><b>Coords:</b> ' + c.lat.toFixed(4) + ', ' + c.lon.toFixed(4) +
        (c.coastKm != null ? ' (' + c.coastKm + ' km from coast)' : '') + '</div>' +
      '<div class="field"><a target="_blank" href="https://www.google.com/maps/search/?api=1&query=' + c.lat + ',' + c.lon + '">Open coords in Google Maps</a></div>' +
      '<div class="field"><a target="_blank" href="https://www.google.com/maps/search/' + encodeURIComponent(c.name + ', ' + c.country) + '">Search "' + esc(c.name) + ', ' + esc(c.country) + '" on Google Maps</a></div>';
  }

  function flyToCity(c) {
    map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 9) });
    showReviewCard(c);
  }

  function step(delta) {
    if (!reviewList.length) return;
    reviewIdx = Math.max(0, Math.min(reviewList.length - 1, reviewIdx + delta));
    reviewPos.textContent = (reviewIdx + 1) + ' / ' + reviewList.length;
    flyToCity(reviewList[reviewIdx]);
  }
  document.getElementById('nextFlag').onclick = () => step(reviewIdx < 0 ? 0 : 1);
  document.getElementById('prevFlag').onclick = () => step(-1);

  document.getElementById('searchGo').onclick = doSearch;
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  function doSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return;
    const match = CITIES.find((c) => c.name && c.name.toLowerCase().includes(q));
    if (match) flyToCity(match);
  }

  [fFlagged, fQuarantined].forEach((el) => el.addEventListener('change', applyFilters));
  [fRatio, fPop].forEach((el) => el.addEventListener('input', applyFilters));

  function addLayers() {
    if (!map.getSource('cities')) {
      map.addSource('cities', { type: 'geojson', data: ALL_GEOJSON });
    }
    if (!map.getLayer('cities-circle')) {
      map.addLayer({
        id: 'cities-circle',
        type: 'circle',
        source: 'cities',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            2, ['interpolate', ['linear'], ['get', 'pop'], 1000, 1, 500000, 4, 20000000, 10],
            8, ['interpolate', ['linear'], ['get', 'pop'], 1000, 3, 500000, 14, 20000000, 40],
            14, ['interpolate', ['linear'], ['get', 'pop'], 1000, 8, 500000, 30, 20000000, 90],
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'quarantined'], 1], '#ff4d4d',
            ['>=', ['get', 'ratio'], 50], '#ff7a1a',
            ['>=', ['get', 'ratio'], 20], '#ffb454',
            ['>', ['get', 'ratio'], 0], '#ffe066',
            '#5aa0ff',
          ],
          'circle-opacity': 0.32,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'quarantined'], 1], '#ff4d4d',
            ['>=', ['get', 'ratio'], 50], '#ff7a1a',
            ['>=', ['get', 'ratio'], 20], '#ffb454',
            ['>', ['get', 'ratio'], 0], '#ffe066',
            '#5aa0ff',
          ],
          'circle-stroke-opacity': 0.9,
        },
      });
    }
    if (!map.getLayer('cities-label')) {
      map.addLayer({
        id: 'cities-label',
        type: 'symbol',
        source: 'cities',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 8, 12, 14, 15],
          'text-variable-anchor': ['top'],
          'text-radial-offset': 0.6,
          'text-allow-overlap': false,
          'symbol-sort-key': ['-', 0, ['get', 'pop']],
        },
        paint: {
          'text-color': '#f2f4f8',
          'text-halo-color': '#0d0f13',
          'text-halo-width': 1.2,
        },
      });
    }
    applyFilters();
  }

  map.on('load', addLayers);
  styleSel.addEventListener('change', () => {
    map.setStyle(styleSel.value);
    map.once('style.load', addLayers);
    persist();
  });

  map.on('click', 'cities-circle', (e) => {
    const p = e.features[0].properties;
    const c = CITIES.find((x) => x.id === p.id);
    if (!c) return;
    reviewIdx = reviewList.indexOf(c);
    reviewPos.textContent = reviewIdx >= 0 ? (reviewIdx + 1) + ' / ' + reviewList.length : '–';
    showReviewCard(c);
  });
  map.on('mouseenter', 'cities-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'cities-circle', () => { map.getCanvas().style.cursor = ''; });
  map.on('moveend', persist);
}
</script>
</body>
</html>
`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('Wrote', outPath, '(' + rows.length + ' cities,', (dataJson.length / 1024).toFixed(0) + 'KB embedded)');
