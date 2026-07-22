const { DatabaseSync } = require('node:sqlite');
const { mollweideInverse } = require('./mollweide.js');
const { repairMojibake } = require('./text-repair.js');

// Returns array of { id, name, country, pop, areaKm2, lat, lon }.
function loadGHSL(gpkgPath) {
  const db = new DatabaseSync(gpkgPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT g.ID_UC_G0 id, g.GC_UCN_MAI_2025 name, g.GC_UCN_LIS_2025 nameList,
           g.GC_CNT_UNN_2025 country, g.GC_POP_TOT_2025 pop, g.GC_UCA_KM2_2025 areaKm2,
           c.GC_UCC_LON_2025 x, c.GC_UCC_LAT_2025 y
    FROM GHSL_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A g
    JOIN UC_centroids c ON c.ID_UC_G0 = g.ID_UC_G0
  `).all();
  db.close();
  return rows.map(r => {
    const [lon, lat] = mollweideInverse(r.x, r.y);
    return {
      id: r.id, name: repairMojibake(r.name), nameList: repairMojibake(r.nameList), country: r.country,
      pop: Math.round(r.pop), areaKm2: r.areaKm2, lat, lon,
    };
  });
}

module.exports = { loadGHSL };
