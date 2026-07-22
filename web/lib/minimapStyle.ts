import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { layersWithPartialCustomTheme } from 'protomaps-themes-base';

// Self-hosted vector tiles (PLAN.md core invariant: this IS the answer key --
// see etl/). Served via the Protomaps Cloudflare Worker (cloudflare/pmtiles-worker/)
// reading from R2 -- a real TileJSON endpoint, not a raw pmtiles:// byte-range
// source, since the Worker decodes tiles server-side rather than handing back
// the archive itself.
export const TILES_SOURCE_ID = 'protomaps';
export const HILLSHADE_SOURCE_ID = 'terrain';
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

/** Inserts a layer right before the first layer with the given id -- used to
 * slot the urban-fabric fill in under the specific-purpose landuse layers
 * (park, hospital, school...) so those still win visually if they overlap,
 * while still drawing over the plain earth/landcover fill beneath. */
function insertBefore(
  layers: LayerSpecification[],
  beforeId: string,
  layer: LayerSpecification
): LayerSpecification[] {
  const index = layers.findIndex((l) => l.id === beforeId);
  if (index === -1) return [...layers, layer];
  return [...layers.slice(0, index), layer, ...layers.slice(index)];
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
    insertBefore(
      layersWithPartialCustomTheme(TILES_SOURCE_ID, 'light', MINIMAP_THEME_OVERRIDES, 'en'),
      'landuse_park',
      URBAN_FABRIC_LAYER
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
