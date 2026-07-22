const KM_PER_DEG_LAT = 111.32;

/** Bounding box [west, south, east, north] `widthKm` x `heightKm` around a center point. */
export function boxAroundCenter(
  lat: number,
  lon: number,
  widthKm: number,
  heightKm: number
): [number, number, number, number] {
  const dLat = heightKm / 2 / KM_PER_DEG_LAT;
  const dLon = widthKm / 2 / (KM_PER_DEG_LAT * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Point `distanceKm` away from (lat, lon) along `bearingDeg` (0=north, 90=east). */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number
): [number, number] {
  const R = 6371;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const dR = distanceKm / R;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng));
  const lon2 =
    lon1 + Math.atan2(Math.sin(brng) * Math.sin(dR) * Math.cos(lat1), Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2));

  return [(lat2 * 180) / Math.PI, (((lon2 * 180) / Math.PI + 540) % 360) - 180];
}

/** Small deterministic hash -> [0, 1), stable for a given seed (e.g. a city id). */
export function seededUnitInterval(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
