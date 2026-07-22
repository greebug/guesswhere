'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildMinimapStyle } from '@/lib/minimapStyle';

interface Dot {
  name: string;
  lat: number;
  lon: number;
}

/** World map with a dot per city from a finished game. Shares the minimap's
 * theme (lib/minimapStyle.ts) so the two read as the same map. No hillshade
 * -- there's no Map/Elevation toggle here, so the extra raster-dem source
 * would be dead weight. */
export default function ResultMap({ dots }: { dots: Dot[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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
      style: buildMinimapStyle(tilesJsonUrl, false),
      center: [10, 20],
      zoom: 0.6,
    });
    map.on('error', (e) => console.warn('MapLibre error:', e.error));
    mapRef.current = map;

    for (const dot of dots) {
      new maplibregl.Marker({ color: '#ef4444' })
        .setLngLat([dot.lon, dot.lat])
        .setPopup(new maplibregl.Popup({ offset: 16 }).setText(dot.name))
        .addTo(map);
    }

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-lg border border-zinc-700"
    />
  );
}
