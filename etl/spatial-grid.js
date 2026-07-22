// Simple lat/lng grid index for nearest-neighbor lookups without a native
// spatial library. Buckets points into ~1-degree cells; query expands the
// search ring until a candidate is found or maxRingKm is exceeded.
const KM_PER_DEG_LAT = 111.32;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

class SpatialGrid {
  constructor(cellDeg = 1) {
    this.cellDeg = cellDeg;
    this.cells = new Map();
  }
  key(lat, lon) {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }
  insert(lat, lon, item) {
    const k = this.key(lat, lon);
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, arr = []);
    arr.push({ lat, lon, item });
  }
  // Returns the nearest inserted item within maxKm, or null.
  nearest(lat, lon, maxKm = 50) {
    const cellKm = this.cellDeg * KM_PER_DEG_LAT;
    const maxRing = Math.ceil(maxKm / cellKm) + 1;
    const cLat = Math.floor(lat / this.cellDeg);
    const cLon = Math.floor(lon / this.cellDeg);
    let best = null, bestDist = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const arr = this.cells.get(`${cLat + dx}:${cLon + dy}`);
          if (!arr) continue;
          for (const p of arr) {
            const d = haversineKm(lat, lon, p.lat, p.lon);
            if (d < bestDist) { bestDist = d; best = p.item; }
          }
        }
      }
      // Once we have a candidate, one extra ring guarantees correctness
      // (a closer point could sit just across a cell boundary).
      if (best && ring * cellKm > bestDist + cellKm) break;
    }
    return bestDist <= maxKm ? { item: best, distKm: bestDist } : null;
  }
}

module.exports = { SpatialGrid, haversineKm };
