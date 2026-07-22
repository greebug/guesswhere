const { PMTiles } = require('pmtiles');
const { VectorTile } = require('@mapbox/vector-tile');
const { PbfReader: Pbf } = require('pbf');
const { NodeFileSource } = require('./node-file-source.js');

const SETTLEMENT_KIND_DETAILS = new Set(['city', 'town', 'village']);

function lonLatToTileFrac(lon, lat, z) {
  const n = 2 ** z;
  const x = (lon + 180) / 360 * n;
  const rad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
  return [x, y];
}

function pixelToLonLat(px, py, z, tx, ty, extent) {
  const n = 2 ** z;
  const lon = (tx + px / extent) / n * 360 - 180;
  const merc = Math.PI * (1 - 2 * (ty + py / extent) / n);
  const lat = 180 / Math.PI * Math.atan(Math.sinh(merc));
  return [lon, lat];
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

class TileLabelSource {
  constructor(path) {
    this.p = new PMTiles(new NodeFileSource(path));
    this.tileCache = new Map(); // "z/x/y" -> decoded feature array (or null)
  }

  async header() {
    if (!this._header) this._header = await this.p.getHeader();
    return this._header;
  }

  async decodeTile(z, tx, ty) {
    const key = `${z}/${tx}/${ty}`;
    if (this.tileCache.has(key)) return this.tileCache.get(key);
    const tile = await this.p.getZxy(z, tx, ty);
    if (!tile) { this.tileCache.set(key, []); return []; }
    const vt = new VectorTile(new Pbf(tile.data));
    const layer = vt.layers['places'];
    const out = [];
    if (layer) {
      const extent = layer.extent;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const geom = f.loadGeometry();
        const pt = geom[0][0];
        const [lon, lat] = pixelToLonLat(pt.x, pt.y, z, tx, ty, extent);
        out.push({ props: f.properties, lon, lat });
      }
    }
    this.tileCache.set(key, out);
    return out;
  }

  // All 'places' features of settlement kind within radiusKm of (lat, lon).
  async findNearbySettlements(lat, lon, radiusKm) {
    const z = (await this.header()).maxZoom;
    const dLat = radiusKm / 111.32;
    const dLon = radiusKm / (111.32 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    const [xMinF, yMinF] = lonLatToTileFrac(lon - dLon, lat + dLat, z);
    const [xMaxF, yMaxF] = lonLatToTileFrac(lon + dLon, lat - dLat, z);
    const xMin = Math.max(0, Math.floor(xMinF)), xMax = Math.floor(xMaxF);
    const yMin = Math.max(0, Math.floor(yMinF)), yMax = Math.floor(yMaxF);

    const results = [];
    for (let tx = xMin; tx <= xMax; tx++) {
      for (let ty = yMin; ty <= yMax; ty++) {
        const feats = await this.decodeTile(z, tx, ty);
        for (const f of feats) {
          if (!SETTLEMENT_KIND_DETAILS.has(f.props.kind_detail)) continue;
          const distKm = haversineKm(lat, lon, f.lat, f.lon);
          if (distKm <= radiusKm) results.push({ ...f, distKm });
        }
      }
    }
    return results;
  }
}

module.exports = { TileLabelSource, haversineKm, SETTLEMENT_KIND_DETAILS };
