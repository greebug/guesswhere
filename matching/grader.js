const { DatabaseSync } = require('node:sqlite');
const { createNameIndex } = require('./name-index.js');
const { createMatcherFromRow } = require('./match.js');

/**
 * Server-side grading service.
 *
 * Per PLAN.md the answer never reaches the client: the browser posts a guess
 * plus a city id, and receives only correct/incorrect (and, on success, the
 * canonical spelling to display). Nothing here exposes the answer for an
 * incorrect guess.
 *
 * Construction cost is a few hundred ms for the whole corpus; do it once at
 * process start, not per request.
 */
function createGrader(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT id, canonical_name, aliases_json, lat, lon, country, iso2,
           pop_ghsl, min_render_zoom
    FROM cities WHERE quarantined = 0
  `).all();
  db.close();

  const nameIndex = createNameIndex(rows);
  const byId = new Map();
  const matchers = new Map();
  for (const r of rows) {
    byId.set(r.id, r);
    matchers.set(r.id, createMatcherFromRow(r, nameIndex));
  }

  return {
    cityCount: rows.length,

    /** Public, non-revealing metadata for a round. Never includes the name. */
    getRoundCity(cityId) {
      const r = byId.get(cityId);
      if (!r) return null;
      return { id: r.id, lat: r.lat, lon: r.lon, minRenderZoom: r.min_render_zoom };
    },

    /**
     * @returns {{correct: boolean, canonicalName: string|null}}
     * canonicalName is populated only on a correct guess.
     */
    grade(cityId, guess) {
      const m = matchers.get(cityId);
      if (!m) return { correct: false, canonicalName: null };
      const r = m.grade(guess);
      return { correct: r.correct, canonicalName: r.correct ? r.canonicalName : null };
    },

    /** Explicit reveal. Separate from grade() so it can be disabled in battle mode. */
    reveal(cityId) {
      const r = byId.get(cityId);
      return r ? r.canonical_name : null;
    },

    /** All playable rows, for round generation in phase 3. */
    allCities() {
      return rows;
    },
  };
}

module.exports = { createGrader };
