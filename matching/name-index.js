const { variants } = require('./normalize.js');

/**
 * A global index of every name belonging to every playable city.
 *
 * This exists to solve a problem that thresholds cannot. Real city pairs sit
 * one edit apart -- Kanpur/Kannur, Pune/Puno, Lima/Lome, Bern/Bonn, Vienna/
 * Vienne. Tightening the fuzzy budget far enough to separate them would also
 * reject ordinary typos, which is the tolerance the game exists to provide.
 *
 * The resolution: fuzzy matching stays generous, but a guess that *exactly*
 * names some other real city is rejected outright. Typing "Kannur" is not a
 * misspelling of "Kanpur" -- it is a different, wrong answer.
 *
 * Names shared by several cities (Springfield, Tripoli, Santiago) map to a set
 * of owners, so a guess is only blocked when the current city is not an owner.
 */
function createNameIndex(rows) {
  const owners = new Map();          // variant -> Set<cityId> (canonical or alias)
  const canonicalOwners = new Map(); // variant -> Set<cityId> (canonical only)

  const add = (map, v, id) => {
    let set = map.get(v);
    if (!set) map.set(v, set = new Set());
    set.add(id);
  };

  for (const row of rows) {
    if (row.quarantined) continue;
    let aliases = [];
    try {
      aliases = JSON.parse(row.aliases_json || '[]');
    } catch { /* ignore corrupt blob */ }
    if (row.canonical_name) {
      for (const v of variants(row.canonical_name)) {
        add(owners, v, row.id);
        add(canonicalOwners, v, row.id);
      }
    }
    for (const name of aliases) {
      if (!name) continue;
      for (const v of variants(name)) add(owners, v, row.id);
    }
  }

  return {
    size: owners.size,
    /** True if `variant` names a real city other than `cityId`. */
    isForeignCity(variant, cityId) {
      const set = owners.get(variant);
      return !!set && !set.has(cityId);
    },
    /**
     * True if `variant` is the CANONICAL name of some other city and is not
     * canonical for this one. Alias lists inherited from GeoNames occasionally
     * carry a neighbouring city's real name (Dayu lists "Nan'an"); a guess
     * that names another city outright should lose to that city, not be
     * credited here. Genuine homonyms (two cities both named Rajgarh) are
     * unaffected, since each is canonical for itself.
     */
    isForeignCanonical(variant, cityId) {
      const set = canonicalOwners.get(variant);
      return !!set && !set.has(cityId);
    },
  };
}

module.exports = { createNameIndex };
