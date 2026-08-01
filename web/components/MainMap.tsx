'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { boxAroundCenter, lonDegreesForKm, distanceKm } from '@/lib/geo';
// Not a bare fetch('/api/...') string: basePath rewrites <Link> and router
// pushes but never a fetch argument, so an un-prefixed one 404s in production
// while working locally against the origin.
import { api } from '@/lib/basePath';

// PLAN.md: main view is pure satellite imagery, no vector layers/labels/
// overlays -- and billed as ONE GL JS map load per game (instantiate once,
// reposition via jumpTo/easeTo between rounds), never the raster tile API.
//
// Per request (2026-07-24): initial/max-zoom framing is 25mi wide, full pan
// scope is 75mi wide (both explicit width targets, not derived from the
// earlier measured-vs-original-game baseline).
const MI_PER_KM = 1 / 1.609344;
const WIDE_WIDTH_KM = 25 / MI_PER_KM; // 40.23
const PAN_WIDTH_KM = 75 / MI_PER_KM; // 120.70
const PAN_HEIGHT_KM = PAN_WIDTH_KM * (9 / 16); // 67.89
const PINPOINT_WIDTH_KM = 3;
const PINPOINT_HEIGHT_KM = 1.5;
const MAX_ZOOM = 18; // matches measured Esri/Mapbox fidelity ceiling in most regions

// GL JS's projection is always 512 CSS px per world tile, regardless of the
// 256px tiles the satellite SOURCE happens to serve. The two numbers are easy
// to confuse and they mean different things -- see the tile-cliff note below.
const PROJECTION_TILE_PX = 512;
const EARTH_CIRCUMFERENCE_KM = 40075.017;

// satellite-v9's raster source is declared `tileSize: 256` with `roundZoom`
// (read off the live map, not assumed), so the tile level it actually draws is
// `round(zoom + 1)`. That puts a hard 2x cliff at every half zoom: landing just
// below one stretches each 256px tile over as much as 362px (2^0.5), landing
// just above it packs the same tile into 181px. Measured on the real map at one
// city: zoom 11.49 draws tiles at 1.404x, zoom 11.51 at 0.712x -- a 0.02 change
// in zoom for a 2x change in effective resolution.
//
// The game opens at exactly minZoom (fitBounds and setMinZoom below are handed
// the same box), and the fitted zoom moves continuously with latitude and the
// container's size -- so which side of the cliff a round lands on is
// effectively arbitrary, and whichever side it is, you look at it for the whole
// round. That was reported as "super blurry at some zoom levels", and it is.
//
// Asking for the @2x variant returns a 512px image for the same 256-unit tile,
// which is precisely what GL JS does on its own on a retina display. Twice the
// source pixels means the worst case becomes 0.707x of native instead of
// 1.414x, and the cliff stops being visible at all.
//
// BILLING: this rewrites a URL GL JS itself generated for the `mapbox://`
// source -- same tile count, same map load. It is NOT the Raster Tiles API
// path that CLAUDE.md's invariant forbids; nothing here constructs its own
// tile endpoint. The only cost is ~2-3x the bytes per tile.
const SATELLITE_TILE_PATH = /^\/v4\/mapbox\.satellite\/\d+\/\d+\/\d+(\.\w+)$/;

// Every path returns `{ url }` rather than `undefined` for "leave it alone":
// GL JS treats a missing return as "unchanged" at runtime, but its
// RequestTransformFunction type requires RequestParameters, and returning the
// URL untouched means exactly the same thing without an assertion.
function upgradeToRetinaTile(url: string, resourceType?: string) {
  if (resourceType !== 'Tile') return { url };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url };
  }
  const match = SATELLITE_TILE_PATH.exec(parsed.pathname);
  // A non-match also covers the already-@2x case a retina display produces:
  // `1771@2x.webp` can't satisfy `\d+(\.\w+)$`, so those are left alone rather
  // than turned into a nonexistent @2x@2x tile.
  if (!match) return { url };
  const ext = match[1];
  parsed.pathname = `${parsed.pathname.slice(0, -ext.length)}@2x${ext}`;
  return { url: parsed.toString() };
}

/**
 * The zoom at which `widthKm` spans exactly `widthPx` of screen.
 *
 * Fitted on WIDTH ALONE, deliberately. This used to hand a 25mi x 14.1mi (16:9)
 * box to `cameraForBounds`, which fits whichever axis is more constraining --
 * and since that box is narrower than any maximized desktop window, HEIGHT won.
 * The result was that the "25 miles across" spec never reached the screen: a
 * maximized 1920x1080 window showed ~31 miles, wider even than the 29.3mi
 * framing this replaced. Width-fitting delivers 25mi on every window shape,
 * because Mercator's x axis is exactly linear in longitude -- no latitude term,
 * unlike the y axis, which is what made the box fit drift in the first place.
 *
 * Returns null before the container has been laid out (clientWidth 0), where
 * the log would be -Infinity.
 */
function zoomForWidthKm(widthPx: number, lat: number, widthKm: number): number | null {
  if (!(widthPx > 0)) return null;
  const worldFraction = lonDegreesForKm(lat, widthKm) / 360;
  return Math.log2(widthPx / (PROJECTION_TILE_PX * worldFraction));
}

/** How many km of ground the container's height covers at `zoom`. */
function visibleHeightKm(heightPx: number, lat: number, zoom: number): number {
  const kmPerPx =
    (EARTH_CIRCUMFERENCE_KM * Math.cos((lat * Math.PI) / 180)) /
    (PROJECTION_TILE_PX * Math.pow(2, zoom));
  return heightPx * kmPerPx;
}

/**
 * Recomputes and reapplies the "can't zoom out past 25 miles wide" floor for
 * the container's CURRENT size. Must be re-run on every resize, not just once
 * -- see the `resize` listener below for why. `setMinZoom` also clamps the
 * current zoom up if it now sits below the floor, which is what keeps the
 * opening view exactly on spec without a separate jump.
 */
function applyWideZoomFloor(map: mapboxgl.Map, lat: number) {
  const minZoom = zoomForWidthKm(map.getContainer().clientWidth, lat, WIDE_WIDTH_KM);
  if (minZoom === null) return;
  map.setMinZoom(minZoom);
}

export interface MainMapHandle {
  /** The recenter/pinpoint button: jump tight onto the current city. */
  recenterPinpoint(): void;
}

interface MainMapProps {
  lat: number;
  lon: number;
  /** Bump this (e.g. round index) to force a jump even if lat/lon repeat. */
  roundKey: number | string;
  /** Game session id, or duel lobby id with `usageKind="duel"`. Used only to
   * attribute this map load to a real session for the usage meter -- see
   * /api/usage/map-load. Omitting it means the load goes uncounted, which is
   * a silent hole in the spend ceiling, so callers should always pass it. */
  usageId?: string;
  usageKind?: 'game' | 'duel';
}

const MainMap = forwardRef<MainMapHandle, MainMapProps>(function MainMap({
  lat,
  lon,
  roundKey,
  usageId,
  usageKind = 'game',
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const centerRef = useRef({ lat, lon });

  useImperativeHandle(ref, () => ({
    recenterPinpoint() {
      const map = mapRef.current;
      if (!map) return;
      const { lat, lon } = centerRef.current;
      const bounds = boxAroundCenter(lat, lon, PINPOINT_WIDTH_KM, PINPOINT_HEIGHT_KM);
      map.fitBounds(bounds, { animate: true, duration: 500 });
    },
  }));

  // One map instance for the whole game (billing: map loads, not tile requests).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      // Not console.error: Next's dev overlay promotes client console.error
      // to a blocking full-screen dialog, which is wrong for an expected,
      // recoverable condition like "token not configured yet".
      console.warn('NEXT_PUBLIC_MAPBOX_TOKEN is not set -- see web/.env.local');
      return;
    }
    mapboxgl.accessToken = token;

    // Constructed already framed at the wide view, not at an arbitrary default
    // -- otherwise the map shows a zoom-10 view for a moment before the
    // round-positioning effect below frames it once the style loads, which
    // reads as a visible "zooms out then back in" flash. The container is laid
    // out by now (this runs in an effect), so the exact zoom is already
    // computable; the `?? 10` only covers a zero-width container.
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: [lon, lat],
      zoom: zoomForWidthKm(containerRef.current.clientWidth, lat, WIDE_WIDTH_KM) ?? 10,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      transformRequest: upgradeToRetinaTile,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    mapRef.current = map;

    // The "25 miles wide, can't zoom out further" cap is viewport-size-dependent
    // (the zoom is computed from the container's CSS pixel width), and Mapbox
    // only recalculates it when we ask it to. Without
    // this, a container that grows AFTER mount -- a browser window spanning
    // dual monitors, or the whole page shrinking via Ctrl/Cmd "-" (which
    // increases the CSS-pixel viewport, since browser zoom is a CSS-pixel
    // scale factor, not a DOM resize the map would otherwise ignore) -- shows
    // more real-world area at the same numeric zoom than the cap intends.
    // Mapbox's own `resize` event fires for exactly these cases, so
    // reapplying the constraint there closes both holes. setMinZoom's
    // documented behavior auto-clamps the current zoom if it's now below the
    // recomputed minimum, so this doesn't need to also force a zoom itself.
    map.on('resize', () => applyWideZoomFloor(map, centerRef.current.lat));

    // Report the billable event itself. Mapbox charges per map load, so this
    // fires exactly once per instance -- `load` is emitted a single time, and
    // this effect creates a single map for the whole game.
    //
    // Fire-and-forget on purpose: metering must never delay or break the map.
    // A dropped report under-counts, which is the safe direction to be wrong
    // in (the budget is set below Mapbox's free tier precisely to absorb that
    // drift). `keepalive` so it still goes out if the tab is closing.
    map.once('load', () => {
      if (!usageId) return;
      fetch(api('/api/usage/map-load'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: usageId, kind: usageKind }),
        keepalive: true,
      }).catch(() => {});
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reposition for a new round.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    centerRef.current = { lat, lon };

    // Applied immediately AND again below once the style is ready -- the zoom
    // floor is pure geometry (container width + target width), it doesn't need
    // a loaded style, so there's no reason for it to wait on 'load' the way
    // setMaxBounds/the recenter still do. Without this, minZoom stayed unset
    // (or the previous round's value) for a real window on every round
    // transition, not just the first -- fast enough scrolling right as a round
    // started could zoom out to see the whole world before settle() ran.
    applyWideZoomFloor(map, lat);

    const settle = () => {
      applyWideZoomFloor(map, lat);
      const container = map.getContainer();
      const wideZoom = zoomForWidthKm(container.clientWidth, lat, WIDE_WIDTH_KM);

      // The pan box is 75mi x 42.2mi. On a tall enough viewport (roughly
      // taller than 1.69x its width -- reachable on a phone in portrait) the
      // 25mi-wide view is TALLER than that box, and Mapbox resolves a viewport
      // that doesn't fit inside maxBounds by zooming in until it does. That
      // would silently override the 25mi width on exactly the devices with the
      // least screen to spare, so the box grows to cover the view when it has
      // to. The 2% margin keeps rounding from re-triggering the same clamp.
      const panHeightKm =
        wideZoom === null
          ? PAN_HEIGHT_KM
          : Math.max(PAN_HEIGHT_KM, visibleHeightKm(container.clientHeight, lat, wideZoom) * 1.02);
      map.setMaxBounds(boxAroundCenter(lat, lon, PAN_WIDTH_KM, panHeightKm));

      // jumpTo, not fitBounds: fitBounds fits whichever axis binds, which is
      // the whole reason the 25mi spec wasn't reaching the screen. The zoom is
      // already known exactly, so set it directly.
      if (wideZoom !== null) map.jumpTo({ center: [lon, lat], zoom: wideZoom });
      else map.jumpTo({ center: [lon, lat] });
    };

    if (map.isStyleLoaded()) settle();
    else map.once('load', settle);
    // roundKey is a deliberate extra trigger: it forces a re-frame even when a
    // round repeats the previous round's coordinates.
  }, [lat, lon, roundKey]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default MainMap;
export { distanceKm };
