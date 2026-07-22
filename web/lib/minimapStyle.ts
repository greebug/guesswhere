import type { StyleSpecification } from 'maplibre-gl';
import { layersWithPartialCustomTheme } from 'protomaps-themes-base';

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
};

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

  return {
    version: 8,
    glyphs: GLYPHS,
    sources,
    layers: [
      ...layersWithPartialCustomTheme(TILES_SOURCE_ID, 'light', MINIMAP_THEME_OVERRIDES, 'en'),
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
