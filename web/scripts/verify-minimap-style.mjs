/**
 * Layer-order and validity checks for the minimap style.
 *
 * The one thing that actually matters here and cannot be seen in this sandbox:
 * terrain shading must sit UNDER every label. It used to be appended last, so
 * turning on Elevation painted hillshade over all eleven symbol layers and
 * washed out the town names -- the small ones worst.
 *
 * Run: node scripts/verify-minimap-style.mjs
 */
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildMinimapStyle } from '../lib/minimapStyle.ts';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};

const TILES = 'https://tiles.example/tiles.json';

for (const withHillshade of [true, false]) {
  console.log(`\n--- buildMinimapStyle(withHillshade: ${withHillshade}) ---`);
  const style = buildMinimapStyle(TILES, withHillshade);

  const errors = validateStyleMin(style);
  check('passes maplibre style-spec validation', errors.length === 0,
    errors.map((e) => `${e.message}`).join('; '));

  const ids = style.layers.map((l) => l.id);
  check('layer ids are unique', new Set(ids).size === ids.length);

  const hill = ids.indexOf('hillshade');
  const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol');
  const lastNonSymbol = style.layers.map((l) => l.type).lastIndexOf('fill') >= 0;

  if (withHillshade) {
    check('hillshade layer exists', hill !== -1);
    check('hillshade source is declared', !!style.sources.terrain);
    check('hillshade is BELOW the first symbol/label layer',
      hill !== -1 && firstSymbol !== -1 && hill < firstSymbol,
      `hillshade at ${hill}, first symbol at ${firstSymbol}`);
    check('every symbol layer is above hillshade',
      style.layers.every((l, i) => l.type !== 'symbol' || i > hill));
    check('hillshade is still above the land fills', hill > 0 && lastNonSymbol);
    check('hillshade starts hidden (Map is the default view)',
      style.layers[hill].layout?.visibility === 'none');
  } else {
    check('no hillshade layer', hill === -1);
    check('no terrain source', !style.sources.terrain);
  }

  // Regression guard for the layers this style inserts by hand -- all of them
  // must stay under the labels too, for the same reason.
  for (const id of ['eliminated_countries_tint', 'landuse_urban_fabric', 'island_markers_50']) {
    const at = ids.indexOf(id);
    check(`${id} is below the labels`, at !== -1 && at < firstSymbol, `at ${at}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
