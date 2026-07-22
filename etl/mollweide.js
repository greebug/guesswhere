// Inverse World Mollweide (ESRI:54009) -> WGS84 lon/lat.
// GHSL centroid coords are in this projection (sphere, R = authalic radius of WGS84).
const R = 6371007.181;

function mollweideInverse(x, y) {
  const theta = Math.asin(y / (R * Math.SQRT2));
  const lat = Math.asin((2 * theta + Math.sin(2 * theta)) / Math.PI);
  const lon = (Math.PI * x) / (2 * Math.SQRT2 * R * Math.cos(theta));
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

module.exports = { mollweideInverse };
