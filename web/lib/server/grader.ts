import { DatabaseSync } from 'node:sqlite';

// matching/name-index.js and match.js are plain CommonJS (shared with the
// phase 2 CLI test suite, which runs outside Next entirely) -- required here
// rather than ported, so validated behavior and test coverage carry over
// unchanged.
//
// Note: this file re-implements matching/grader.js's thin DB-wiring layer
// rather than requiring grader.js directly. Turbopack's CJS interop chokes
// specifically on a nested `require('node:sqlite')` reached through an
// external package (works fine as a direct ESM import, as used below) --
// so the sqlite access stays here in TS, and only the pure-JS matching
// logic (which never touches node:sqlite) is required from `matching`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createNameIndex } = require('matching/name-index.js') as {
  createNameIndex: (rows: CityRow[]) => NameIndex;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createMatcherFromRow } = require('matching/match.js') as {
  createMatcherFromRow: (row: CityRow, nameIndex: NameIndex) => CityMatcher;
};

export interface RoundCity {
  id: number;
  lat: number;
  lon: number;
  minRenderZoom: number;
}

export interface CityRow {
  id: number;
  canonical_name: string;
  aliases_json: string;
  lat: number;
  lon: number;
  country: string;
  iso2: string | null;
  pop_ghsl: number;
  min_render_zoom: number;
  dist_to_coast_km: number | null;
}

interface NameIndex {
  isForeignCity(variant: string, cityId: number): boolean;
  isForeignCanonical(variant: string, cityId: number): boolean;
}

interface CityMatcher {
  grade(guess: string): { correct: boolean; canonicalName: string | null };
}

export interface Grader {
  cityCount: number;
  getRoundCity(cityId: number): RoundCity | null;
  getCityRow(cityId: number): CityRow | null;
  grade(cityId: number, guess: string): { correct: boolean; canonicalName: string | null };
  /** "City, Country" -- for showing the answer when the player DIDN'T get it
   * (reveal / duel round timeout). Never used for a correct guess: the
   * player already knew the country then, only the exact spelling was in
   * question, and `grade()`'s canonicalName already covers that case. */
  revealWithCountry(cityId: number): string | null;
  allCities(): CityRow[];
}

function buildGrader(dbPath: string): Grader {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT id, canonical_name, aliases_json, lat, lon, country, iso2,
           pop_ghsl, min_render_zoom, dist_to_coast_km
    FROM cities WHERE quarantined = 0
  `).all() as unknown as CityRow[];
  db.close();

  const nameIndex = createNameIndex(rows);
  const byId = new Map<number, CityRow>();
  const matchers = new Map<number, CityMatcher>();
  for (const r of rows) {
    byId.set(r.id, r);
    matchers.set(r.id, createMatcherFromRow(r, nameIndex));
  }

  return {
    cityCount: rows.length,

    getRoundCity(cityId) {
      const r = byId.get(cityId);
      if (!r) return null;
      return { id: r.id, lat: r.lat, lon: r.lon, minRenderZoom: r.min_render_zoom };
    },

    getCityRow(cityId) {
      return byId.get(cityId) ?? null;
    },

    grade(cityId, guess) {
      const m = matchers.get(cityId);
      if (!m) return { correct: false, canonicalName: null };
      const r = m.grade(guess);
      return { correct: r.correct, canonicalName: r.correct ? r.canonicalName : null };
    },

    revealWithCountry(cityId) {
      const r = byId.get(cityId);
      if (!r) return null;
      return r.country ? `${r.canonical_name}, ${r.country}` : r.canonical_name;
    },

    allCities() {
      return rows;
    },
  };
}

// Module-level singleton: building the index over ~11k cities costs a few
// hundred ms and should happen once per server process, not per request.
let grader: Grader | null = null;

export function getGrader(): Grader {
  if (!grader) {
    const dbPath = process.env.CITIES_DB;
    if (!dbPath) throw new Error('CITIES_DB env var is not set (see web/.env.local)');
    grader = buildGrader(dbPath);
  }
  return grader;
}
