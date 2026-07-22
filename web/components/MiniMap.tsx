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

type Layer = 'map' | 'elevation';

interface MiniMapProps {
  lat: number;
  lon: number;
  roundKey: number | string;
}

export default function MiniMap({ roundKey }: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [layer, setLayer] = useState<Layer>('map');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const tilesJsonUrl = process.env.NEXT_PUBLIC_TILES_URL;
    if (!tilesJsonUrl) {
      console.warn('NEXT_PUBLIC_TILES_URL is not set -- see web/.env.local');
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      attributionControl: { compact: true },
      style: buildMinimapStyle(tilesJsonUrl, true),
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
    });
    map.on('error', (e) => console.warn('MapLibre error:', e.error));
    mapRef.current = map;

    // The hover-to-expand panel changes the container's CSS size without
    // triggering a window resize event, which is what maplibre normally
    // listens for -- so it never learns the canvas grew unless told directly.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New round: back to the same neutral world view, not the answer.
  useEffect(() => {
    mapRef.current?.jumpTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM });
  }, [roundKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const setVisible = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    setVisible('hillshade', layer === 'elevation');
  }, [layer]);

  // Collapsed sits at bottom-10 rather than bottom-4: the main map mounts the
  // Mapbox logo and attribution control at its own bottom-left, occupying
  // roughly the lowest 33px. Overlapping them would bury an attribution the
  // Mapbox ToS requires stay visible. The expanded state (bottom-24) already
  // clears it.
  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={`absolute z-20 left-4 transition-all duration-200 ${expanded ? 'bottom-24' : 'bottom-10'}`}
    >
      <div
        className={`relative overflow-hidden rounded border-2 border-white/30 shadow-lg transition-all duration-200 ${
          expanded ? 'h-[50vh] w-[42vw]' : 'h-56 w-72'
        }`}
      >
        <div ref={containerRef} className="h-full w-full" />
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
        {!expanded && (
          <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
            hover to expand
          </div>
        )}
      </div>

      {/* Invisible hover bridge: expanding the panel raises it off the bottom
          edge (above), which opens a gap between it and the bottom-center
          answer box. Without this, crossing that gap means passing over bare
          satellite imagery -- outside this component entirely -- which ends
          the hover and collapses the panel before the cursor ever arrives.
          This fills exactly that reclaimed strip so the hover state survives
          the trip. AnswerBox sits at a higher z-index (see PlayClient) so it
          still receives clicks/typing wherever the two visually overlap. */}
      {expanded && <div className="absolute bottom-0 left-0 h-24 w-[75vw]" />}
    </div>
  );
}
