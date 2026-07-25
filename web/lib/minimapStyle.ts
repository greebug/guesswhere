import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { layersWithPartialCustomTheme } from 'protomaps-themes-base';
import { api } from '@/lib/basePath';

// Self-hosted vector tiles (PLAN.md core invariant: this IS the answer key --
// see etl/). Served via the Protomaps Cloudflare Worker (cloudflare/pmtiles-worker/)
// reading from R2 -- a real TileJSON endpoint, not a raw pmtiles:// byte-range
// source, since the Worker decodes tiles server-side rather than handing back
// the archive itself.
export const TILES_SOURCE_ID = 'protomaps';
export const HILLSHADE_SOURCE_ID = 'terrain';
export const RIVERS_SOURCE_ID = 'ne-rivers';
export const ISLANDS_SOURCE_ID = 'ne-islands';
export const ELIMINATED_SOURCE_ID = 'eliminated-countries';
export const ELIMINATED_LAYER_ID = 'eliminated_countries_tint';
// Served from web/public/rivers.json -- Natural Earth's ne_50m_rivers_lake_centerlines,
// trimmed to River features only, {min_zoom, geometry}. See buildRiverOverlayLayers()
// below for why this exists at all.
// basePath does not rewrite a plain string like this one, only <Link>/router
// hrefs and /_next/* assets -- so the prefix is applied explicitly.
const RIVERS_URL = api('/rivers.json');
// The stock Protomaps tileset's own water_river LineString features simply
// don't exist in the tile data below z9 (confirmed by fetching real tiles
// along the Ob river and inspecting feature geometry types directly -- not a
// style minzoom setting, an actual data gap in the public build). Below z9,
// this overlay is the only river data on the minimap.
//
// Cut off well before that z9 handoff (not right at it) -- Natural Earth's
// generalized centerlines don't trace the same path pixel-for-pixel as the
// tileset's actual OSM-traced rivers, so a hard handoff at z9 read as the
// two visibly overlapping/diverging for a few zoom levels around the seam.
// Ending the overlay earlier leaves a small gap with no river shown rather
// than two slightly different lines shown at once -- the better tradeoff.
const RIVER_OVERLAY_MAXZOOM = 7;
// Marker points for small, isolated islands -- see tools/build-islands.js for
// what qualifies and why. Same basePath caveat as RIVERS_URL.
const ISLANDS_URL = api('/islands.json');
// AWS's public Terrarium-encoded terrain tiles -- free, no key, no account.
// Stands in for phase 1's deferred dedicated elevation download.
const TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';

// The stock 'light' theme is low-contrast almost everywhere land-cover is
// concerned: forest, scrub, sand, and plain earth all land within a few RGB
// points of each other, and building footprints (#cccccc) are literally the
// same color as the canvas background -- so urban areas render as nothing at
// all. That made the minimap read as a flat, textureless grey/tan wash with
// no way to tell "vegetated" from "desert" from "built-up," which is exactly
// what a minimap is for. This overrides just the colors that matter for
// reading population-center shape at a glance: green vegetation, warm tan
// dry/unpopulated land, and a visible grey for building footprints.
export const MINIMAP_THEME_OVERRIDES = {
  background: '#f2f0ea',
  earth: '#ecdfb4',
  sand: '#ecdfb4',
  beach: '#f2e8c9',
  glacier: '#f5f5f5',
  wood_a: '#8fc48f',
  wood_b: '#6aab6a',
  scrub_a: '#a9cf8d',
  scrub_b: '#8ec46a',
  park_a: '#9ecf8d',
  park_b: '#7ec47e',
  water: '#79c8e0',
  buildings: '#adadad',
  industrial: '#c3c3c8',
  aerodrome: '#c9c9cf',
  military: '#d6d0c8',
  // Darker than the theme default (#adadad) so country lines read clearly
  // against the tan earth fill -- width is bumped separately below, since
  // the Theme type only exposes color, not line-width.
  boundaries: '#707070',
};

// protomaps-themes-base has no concept of general "this is a built-up area"
// shading between the two zoom bands that actually carry that data: the
// tileset's own `landcover` layer (kind=urban_area) only exists up to z7,
// and individual `buildings` footprints don't start until z11 -- so a city
// viewed at typical minimap zoom fell into a dead zone with nothing to
// distinguish it from scrubland (confirmed by fetching a real tile: the
// `landuse` layer DOES carry kind='residential'/'commercial' polygons at
// z10, the theme just never draws them). This fills that gap directly.
const URBAN_FABRIC_LAYER: LayerSpecification = {
  id: 'landuse_urban_fabric',
  type: 'fill',
  source: TILES_SOURCE_ID,
  'source-layer': 'landuse',
  filter: ['in', ['get', 'kind'], ['literal', ['residential', 'commercial', 'retail']]],
  paint: {
    'fill-color': '#d6d6d6',
  },
};

// A country whose city has already been found (or revealed) can't come up
// again -- solo games never repeat a country -- so it's dead space for every
// remaining round. This washes it out just enough to register peripherally:
// "don't bother sweeping India again," without ever competing with the actual
// map for attention. Deliberately strongest at the zooms where you're scanning
// whole continents and nearly gone by the time you're reading city shapes,
// where it would just be in the way -- but never all the way to zero, since
// "wait, was the last one in India or Pakistan?" is a question you ask while
// zoomed in.
//
// The colors mirror the answer box: green for a country you found, amber for
// one you gave up on. Both are pulled well toward teal/orange of their
// Tailwind equivalents (green-500 #22c55e, amber-500 #f59e0b) on purpose --
// the basemap's own vegetation is a yellow-leaning green (#6aab6a..#a9cf8d)
// and a matching green wash over it reads as more forest, not as a state
// change. Cooling the green until it's clearly not-a-plant is what makes it
// legible at 20% opacity.
const ELIMINATED_TINT_LAYER: LayerSpecification = {
  id: ELIMINATED_LAYER_ID,
  type: 'fill',
  source: ELIMINATED_SOURCE_ID,
  paint: {
    'fill-color': ['match', ['get', 'outcome'], 'revealed', '#e08a1e', '#00a884'],
    // A saturated hue carries more visual weight than the neutral grey this
    // started as, so the whole curve sits a touch lower than the grey's did.
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.2, 5, 0.18, 8, 0.09, 11, 0.055],
  },
};

// Faint "there is land here" rings, in size buckets that fade in and out on
// their own zoom windows.
//
// One flat set of markers for every island at every zoom was the first
// attempt and was too much: 1,000+ dots all switched on at world view, where
// the ones you actually navigate by are drowned out by specks. An island is
// only worth marking across the band where it's too small to see but big
// enough to be looking for -- roughly, while its true width is between about
// a third of a pixel and six pixels. Since a pixel is worth ~2x fewer km per
// zoom level, that band shifts down the zoom range as islands get smaller,
// which is what these buckets encode: at z0 only the 50km-and-up islands are
// marked (~120 of them worldwide), and the small stuff fades in later, as you
// close in on somewhere specific.
//
// MapLibre can't take a per-feature zoom threshold in a filter (zoom is only
// valid at the top level of a step/interpolate), so this is one layer per
// bucket -- same shape as buildRiverOverlayLayers() below, for the same
// reason.
const ISLAND_BUCKETS = [
  { minSpanKm: 3, maxSpanKm: 8, fadeIn: [4.0, 4.8], fadeOut: [8.5, 9.3] },
  { minSpanKm: 8, maxSpanKm: 20, fadeIn: [2.6, 3.4], fadeOut: [7.0, 7.8] },
  { minSpanKm: 20, maxSpanKm: 50, fadeIn: [1.0, 1.8], fadeOut: [5.5, 6.3] },
  { minSpanKm: 50, maxSpanKm: 120, fadeIn: [0, 0], fadeOut: [4.2, 5.0] },
  { minSpanKm: 120, maxSpanKm: Infinity, fadeIn: [0, 0], fadeOut: [3.0, 3.8] },
] as const;

// Peak opacity, low enough that a cluster of markers reads as texture rather
// than as a rash of dots. The ring carries the shape; the fill is barely
// there, just enough to say "land" rather than "circle".
const ISLAND_FILL_OPACITY = 0.3;
const ISLAND_STROKE_OPACITY = 0.65;

function islandFade(bucket: (typeof ISLAND_BUCKETS)[number], peak: number) {
  const [inStart, inEnd] = bucket.fadeIn;
  const [outStart, outEnd] = bucket.fadeOut;
  const stops =
    inEnd > inStart ? [inStart, 0, inEnd, peak, outStart, peak, outEnd, 0] : [outStart, peak, outEnd, 0];
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

function buildIslandMarkerLayers(): LayerSpecification[] {
  return ISLAND_BUCKETS.map((bucket) => {
    const filter = Number.isFinite(bucket.maxSpanKm)
      ? ['all', ['>=', ['get', 'span'], bucket.minSpanKm], ['<', ['get', 'span'], bucket.maxSpanKm]]
      : ['>=', ['get', 'span'], bucket.minSpanKm];
    return {
      id: `island_markers_${bucket.minSpanKm}`,
      type: 'circle',
      source: ISLANDS_SOURCE_ID,
      minzoom: bucket.fadeIn[0],
      maxzoom: bucket.fadeOut[1],
      filter,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 4, 3, 9, 4],
        'circle-color': MINIMAP_THEME_OVERRIDES.earth,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#5f8ea3',
        'circle-opacity': islandFade(bucket, ISLAND_FILL_OPACITY),
        'circle-stroke-opacity': islandFade(bucket, ISLAND_STROKE_OPACITY),
      },
    } as unknown as LayerSpecification;
  });
}

/** Inserts one or more layers right before the first layer with the given id
 * -- used to slot the urban-fabric fill in under the specific-purpose
 * landuse layers (park, hospital, school...) so those still win visually if
 * they overlap, while still drawing over the plain earth/landcover fill
 * beneath; and to slot the river overlay in right where the tileset's own
 * water_river layer sits, so the z9 handoff between them is seamless. */
function insertBefore(
  layers: LayerSpecification[],
  beforeId: string,
  layer: LayerSpecification | LayerSpecification[]
): LayerSpecification[] {
  const toInsert = Array.isArray(layer) ? layer : [layer];
  const index = layers.findIndex((l) => l.id === beforeId);
  if (index === -1) return [...layers, ...toInsert];
  return [...layers.slice(0, index), ...toInsert, ...layers.slice(index)];
}

// Natural Earth curates a per-river min_zoom (2-5 in the 50m set) so major
// rivers appear before minor tributaries as you zoom in -- worth preserving
// rather than flattening to one cutoff. MapLibre doesn't support a
// per-feature data-driven zoom threshold in a filter (zoom expressions are
// only valid in step/interpolate), so this buckets by the floor of min_zoom
// into a handful of layers, each gated by both a static filter on the
// bucket's range and the layer's own `minzoom`.
const RIVER_ZOOM_BUCKETS = [2, 3, 4, 5] as const;

function buildRiverOverlayLayers(): LayerSpecification[] {
  return RIVER_ZOOM_BUCKETS.map((bucket, i) => {
    const next: number | undefined = RIVER_ZOOM_BUCKETS[i + 1];
    const filter =
      next === undefined
        ? ['>=', ['get', 'min_zoom'], bucket]
        : ['all', ['>=', ['get', 'min_zoom'], bucket], ['<', ['get', 'min_zoom'], next]];
    return {
      id: `ne_rivers_${bucket}`,
      type: 'line',
      source: RIVERS_SOURCE_ID,
      minzoom: bucket,
      maxzoom: RIVER_OVERLAY_MAXZOOM,
      filter,
      paint: {
        'line-color': MINIMAP_THEME_OVERRIDES.water,
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.6, RIVER_OVERLAY_MAXZOOM, 1.2],
      },
    } as unknown as LayerSpecification;
  });
}

/** Country-level boundary lines are the same 0.7px width for every theme --
 * not something MINIMAP_THEME_OVERRIDES' color-only Theme type can reach --
 * so it's bumped here directly on the generated layer. */
function thickenCountryBorders(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((l) =>
    l.id === 'boundaries_country'
      ? ({ ...l, paint: { ...l.paint, 'line-width': 1.4 } } as LayerSpecification)
      : l
  );
}

/** Shared by the in-game minimap and the result page's world map, so the
 * theme above lives in exactly one place.
 *
 * `withHillshade` is the minimap's Map/Elevation toggle; the result map has no
 * toggle and skips the extra raster-dem source entirely. */
export function buildMinimapStyle(
  tilesJsonUrl: string,
  withHillshade: boolean
): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    [TILES_SOURCE_ID]: { type: 'vector', url: tilesJsonUrl },
    [RIVERS_SOURCE_ID]: { type: 'geojson', data: RIVERS_URL },
    [ISLANDS_SOURCE_ID]: { type: 'geojson', data: ISLANDS_URL },
    // Starts empty and is filled in at runtime as rounds settle -- see
    // MiniMap's setData call. Declaring it here rather than adding the source
    // on demand means the layer's position in the stack is fixed by the style
    // itself, instead of depending on when the first round happens to settle.
    [ELIMINATED_SOURCE_ID]: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
  };
  if (withHillshade) {
    sources[HILLSHADE_SOURCE_ID] = {
      type: 'raster-dem',
      tiles: [TERRAIN_TILE_URL],
      tileSize: 256,
      encoding: 'terrarium',
      attribution: 'Terrain tiles &copy; <a href="https://github.com/tilezen/joerd">Tilezen</a>',
    };
  }

  const baseLayers = thickenCountryBorders(
    // The tint and the island markers both slot in just under the country
    // boundary lines: over every land/landuse fill (so the wash actually
    // covers the terrain it's dimming, and an island marker isn't hidden by
    // the sea), but under borders and every label, which have to stay crisp.
    insertBefore(
      insertBefore(
        insertBefore(
          layersWithPartialCustomTheme(TILES_SOURCE_ID, 'light', MINIMAP_THEME_OVERRIDES, 'en'),
          'landuse_park',
          URBAN_FABRIC_LAYER
        ),
        'water_river',
        buildRiverOverlayLayers()
      ),
      'boundaries_country',
      [ELIMINATED_TINT_LAYER, ...buildIslandMarkerLayers()]
    )
  );

  return {
    version: 8,
    glyphs: GLYPHS,
    sources,
    layers: [
      ...baseLayers,
      ...(withHillshade
        ? [
            {
              id: 'hillshade',
              type: 'hillshade' as const,
              source: HILLSHADE_SOURCE_ID,
              layout: { visibility: 'none' as const },
              paint: { 'hillshade-exaggeration': 0.7 },
            },
          ]
        : []),
    ],
  };
}
