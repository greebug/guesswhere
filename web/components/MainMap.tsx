'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { boxAroundCenter, distanceKm } from '@/lib/geo';

// PLAN.md: main view is pure satellite imagery, no vector layers/labels/
// overlays -- and billed as ONE GL JS map load per game (instantiate once,
// reposition via jumpTo/easeTo between rounds), never the raster tile API.
//
// Measured directly against the original game: 11.31mi N/S x 26.59mi E/W
// (18.2km x 42.8km). An earlier estimate of 27km x 12km was a rough guess
// from the initial description, not a real measurement -- this replaces it.
const WIDE_WIDTH_KM = 42.8;
const WIDE_HEIGHT_KM = 18.2;
const PAN_RADIUS_KM = 50; // "100km left to right" => 50km radius from center
const PINPOINT_WIDTH_KM = 3;
const PINPOINT_HEIGHT_KM = 1.5;
const MAX_ZOOM = 18; // matches measured Esri/Mapbox fidelity ceiling in most regions
const REBOUND_FRACTION = 0.5; // "moves you back closer to the middle" on release -- not all the way

// Recomputes and reapplies the "can't zoom out past 27km wide" floor for the
// container's CURRENT size. Must be re-run on every resize, not just once --
// see the `resize` listener below for why.
function applyWideZoomFloor(map: mapboxgl.Map, lat: number, lon: number) {
  const wideBounds = boxAroundCenter(lat, lon, WIDE_WIDTH_KM, WIDE_HEIGHT_KM);
  const camera = map.cameraForBounds(wideBounds);
  const minZoom = camera && typeof camera.zoom === 'number' ? camera.zoom : 10;
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
}

const MainMap = forwardRef<MainMapHandle, MainMapProps>(function MainMap({ lat, lon, roundKey }, ref) {
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

    // Constructed already framed to the wide-view box, not a fixed center/zoom
    // -- otherwise the map shows an arbitrary zoom-10 view for a moment before
    // the round-positioning effect below fits it to the real bounds once the
    // style loads, which reads as a visible "zooms out then back in" flash.
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      bounds: boxAroundCenter(lat, lon, WIDE_WIDTH_KM, WIDE_HEIGHT_KM),
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    mapRef.current = map;

    // "moves you back closer to the middle" -- eases partway back to the
    // round's center after a drag, rather than either letting the player
    // stay wherever they panned or snapping fully back.
    map.on('dragend', () => {
      const { lat: cLat, lon: cLon } = centerRef.current;
      const cur = map.getCenter();
      const reboundLon = cur.lng + (cLon - cur.lng) * REBOUND_FRACTION;
      const reboundLat = cur.lat + (cLat - cur.lat) * REBOUND_FRACTION;
      map.easeTo({ center: [reboundLon, reboundLat], duration: 600 });
    });

    // The "27km wide, can't zoom out further" cap is viewport-size-dependent
    // (cameraForBounds computes zoom from the container's CSS pixel
    // dimensions), and Mapbox only recalculates it when we ask it to. Without
    // this, a container that grows AFTER mount -- a browser window spanning
    // dual monitors, or the whole page shrinking via Ctrl/Cmd "-" (which
    // increases the CSS-pixel viewport, since browser zoom is a CSS-pixel
    // scale factor, not a DOM resize the map would otherwise ignore) -- shows
    // more real-world area at the same numeric zoom than the cap intends.
    // Mapbox's own `resize` event fires for exactly these cases, so
    // reapplying the constraint there closes both holes. setMinZoom's
    // documented behavior auto-clamps the current zoom if it's now below the
    // recomputed minimum, so this doesn't need to also force a zoom itself.
    map.on('resize', () => applyWideZoomFloor(map, centerRef.current.lat, centerRef.current.lon));

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

    // Applied immediately AND again below once the style is ready --
    // cameraForBounds is pure geometry (container size + target bounds), it
    // doesn't need a loaded style, so there's no reason for the zoom floor
    // to wait on 'load' the way fitBounds/setMaxBounds still do. Without
    // this, minZoom stayed unset (or the previous round's value) for a real
    // window on every round transition, not just the first -- fast enough
    // scrolling right as a round started could zoom out to see the whole
    // world before settle() got a chance to run.
    applyWideZoomFloor(map, lat, lon);

    const settle = () => {
      applyWideZoomFloor(map, lat, lon);
      const panBounds = boxAroundCenter(lat, lon, PAN_RADIUS_KM * 2, PAN_RADIUS_KM * 2);
      map.setMaxBounds(panBounds);
      const wideBounds = boxAroundCenter(lat, lon, WIDE_WIDTH_KM, WIDE_HEIGHT_KM);
      map.fitBounds(wideBounds, { animate: false });
    };

    if (map.isStyleLoaded()) settle();
    else map.once('load', settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, roundKey]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default MainMap;
export { distanceKm };
