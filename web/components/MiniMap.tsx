'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildMinimapStyle } from '@/lib/minimapStyle';

// Every round starts on the same neutral world view, unrelated to the
// answer's location -- centering on (or near) the actual coordinate would
// hand the round over for free. The player has to navigate there themselves,
// same as they would with the main satellite view's visual clues.
const WORLD_CENTER: [number, number] = [10, 15]; // [lng, lat]
const WORLD_ZOOM = 1.5;

// Below this there's no meaningful "zoomed into a border" to label -- and it
// keeps the lookup from ever firing at the default world view.
const BORDER_LABEL_MIN_ZOOM = 4;
// Sampled corner-to-corner (not left/right or top/bottom) so a border
// running in roughly any direction still crosses between the two points --
// a horizontal-only pair would miss an east-west border (e.g. much of the
// France/Spain line), a vertical-only pair would miss a north-south one.
// Fixed screen fractions (not stored pixel coordinates) so the label
// positions stay correct across the collapsed/expanded resize for free,
// without needing to recompute on every container resize.
const BORDER_SAMPLE_POINTS = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.75 },
] as const;

function roundedCoordKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

type Layer = 'map' | 'elevation';

interface MiniMapProps {
  lat: number;
  lon: number;
  roundKey: number | string;
  // True once this round is missed -- revealed (solo) or timed out (duel) --
  // so the player can see where it actually was. Never set for a correct
  // guess: they already found it themselves.
  showAnswer?: boolean;
}

export default function MiniMap({ lat, lon, roundKey, showAnswer = false }: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [layer, setLayer] = useState<Layer>('map');
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = hovering || pinned;
  // Names of the countries on each side of a border currently crossing the
  // view, or null when no border is on screen (or both sample points landed
  // in the same country). Positions are fixed screen fractions, not stored
  // here -- see BORDER_SAMPLE_FRACTIONS.
  const [borderLabels, setBorderLabels] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const tilesJsonUrl = process.env.NEXT_PUBLIC_TILES_URL;
    if (!tilesJsonUrl) {
      console.warn('NEXT_PUBLIC_TILES_URL is not set -- see web/.env.local');
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      // Default position (bottom-right) sits right under the "hover to
      // expand" hint in the same corner -- bottom-left is otherwise empty.
      attributionControl: false,
      style: buildMinimapStyle(tilesJsonUrl, true),
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.on('error', (e) => console.warn('MapLibre error:', e.error));
    mapRef.current = map;

    // The hover-to-expand panel changes the container's CSS size without
    // triggering a window resize event, which is what maplibre normally
    // listens for -- so it never learns the canvas grew unless told directly.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    // Country labels for whichever border the two sample points straddle.
    // Only fires on moveend (not every drag frame) once zoomed in past
    // BORDER_LABEL_MIN_ZOOM; a small in-memory cache then skips the network
    // call entirely for the common case of nudging the map slightly and
    // landing on the same two countries. (Gating on an actual rendered
    // 'boundaries_country' feature would be more precise, but
    // queryRenderedFeatures reads from the WebGL render tree, which is only
    // populated after a real paint -- unverifiable here, and a real user's
    // two country lookups differing is just as reliable a signal.)
    const countryCache = new Map<string, string | null>();
    let requestSeq = 0;
    const updateBorderLabels = async () => {
      const container = containerRef.current;
      if (!container) return;
      if (map.getZoom() < BORDER_LABEL_MIN_ZOOM) {
        setBorderLabels(null);
        return;
      }

      const { width, height } = container.getBoundingClientRect();
      const lonLats = BORDER_SAMPLE_POINTS.map((p) => map.unproject([width * p.x, height * p.y]));
      const keys = lonLats.map((ll) => roundedCoordKey(ll.lat, ll.lng));

      const seq = ++requestSeq;
      let names: (string | null)[];
      if (keys.every((k) => countryCache.has(k))) {
        names = keys.map((k) => countryCache.get(k) ?? null);
      } else {
        try {
          const qs = lonLats.map((ll) => `point=${ll.lat.toFixed(3)},${ll.lng.toFixed(3)}`).join('&');
          const res = await fetch(`/api/geo/country?${qs}`);
          if (!res.ok) return;
          const data = await res.json();
          names = data.countries as (string | null)[];
          keys.forEach((k, i) => countryCache.set(k, names[i]));
        } catch {
          return; // transient network blip -- the next moveend tries again
        }
      }
      if (seq !== requestSeq) return; // a newer move already superseded this one

      setBorderLabels(
        names[0] && names[1] && names[0] !== names[1] ? { a: names[0], b: names[1] } : null
      );
    };
    map.on('moveend', updateBorderLabels);

    return () => {
      map.off('moveend', updateBorderLabels);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New round: back to the same neutral world view, not the answer. Clear
  // border labels immediately rather than waiting for the async moveend
  // re-check to catch up. Also drop any leftover marker from the previous
  // round -- showAnswer should flip to false for a fresh round too, but this
  // guards against a stale dot surviving a render where the two updates land
  // out of step.
  useEffect(() => {
    mapRef.current?.jumpTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM });
    setBorderLabels(null);
    markerRef.current?.remove();
    markerRef.current = null;
  }, [roundKey]);

  // The missed-round marker. Only ever shown for the round it belongs to --
  // roundKey changes (above) tear it down before a new round's showAnswer
  // could turn it back on for the wrong city.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showAnswer) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      // setLngLat before addTo -- addTo calls _update() immediately, which
      // reads the (otherwise still-unset) position synchronously.
      markerRef.current = new maplibregl.Marker({ color: '#ef4444' }).setLngLat([lon, lat]).addTo(map);
    } else {
      markerRef.current.setLngLat([lon, lat]);
    }
  }, [showAnswer, lat, lon, roundKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const setVisible = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    setVisible('hillshade', layer === 'elevation');
  }, [layer]);

  // The main map mounts the Mapbox logo and attribution control at its own
  // bottom-left -- overlapping them would bury an attribution the Mapbox ToS
  // requires stay visible. A prior pass (bottom-10 collapsed / bottom-24
  // expanded) measured 11px of clearance geometrically, but never got a real
  // screenshot to confirm it (sandbox browser can't render one -- see
  // CLAUDE.md); a real-browser screenshot showed the two actually
  // overlapping. Bumped both offsets well past the logo's own ~33px height
  // for real margin instead of a razor-thin gap.
  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`absolute z-20 left-4 transition-all duration-200 ${expanded ? 'bottom-28' : 'bottom-16'}`}
    >
      <div
        className={`relative overflow-hidden rounded border-2 border-white/30 shadow-lg transition-all duration-200 ${
          expanded ? 'h-[50vh] w-[42vw]' : 'h-56 w-72'
        }`}
      >
        <div ref={containerRef} className="h-full w-full" />
        {borderLabels && (
          <>
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-zinc-800 shadow"
              style={{ left: `${BORDER_SAMPLE_POINTS[0].x * 100}%`, top: `${BORDER_SAMPLE_POINTS[0].y * 100}%` }}
            >
              {borderLabels.a}
            </div>
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-zinc-800 shadow"
              style={{ left: `${BORDER_SAMPLE_POINTS[1].x * 100}%`, top: `${BORDER_SAMPLE_POINTS[1].y * 100}%` }}
            >
              {borderLabels.b}
            </div>
          </>
        )}
        <div className="absolute top-1 left-1 z-10 flex gap-1 text-xs">
          {(['map', 'elevation'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              className={`rounded px-2 py-0.5 ${
                layer === l ? 'bg-white text-black' : 'bg-black/50 text-white'
              }`}
            >
              {l === 'map' ? 'Map' : 'Elevation'}
            </button>
          ))}
        </div>
        {/* Click to pin, not hold-Ctrl-to-pin (the prior mechanism): holding
            Ctrl while typing a letter into the answer box triggers a browser
            keyboard shortcut instead of inserting the character, which broke
            the exact use case this exists for -- reading the minimap while
            typing a guess. A click has no such conflict. */}
        <div className="absolute top-1 right-1 z-10 text-xs">
          <button
            onClick={() => setPinned((p) => !p)}
            title={pinned ? 'Unpin the minimap' : 'Pin the minimap open'}
            className={`rounded px-2 py-0.5 ${pinned ? 'bg-white text-black' : 'bg-black/50 text-white'}`}
          >
            📌
          </button>
        </div>
        <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
          {pinned ? '📌 pinned -- click to unpin' : expanded ? '📌 to keep open' : 'hover to expand'}
        </div>
      </div>

      {/* Invisible hover bridge: expanding the panel raises it off the bottom
          edge (above), which opens a gap between it and the bottom-center
          answer box. Without this, crossing that gap means passing over bare
          satellite imagery -- outside this component entirely -- which ends
          the hover and collapses the panel before the cursor ever arrives.
          This fills exactly that reclaimed strip so the hover state survives
          the trip. AnswerBox sits at a higher z-index (see PlayClient) so it
          still receives clicks/typing wherever the two visually overlap. */}
      {expanded && <div className="absolute bottom-0 left-0 h-28 w-[75vw]" />}
    </div>
  );
}
