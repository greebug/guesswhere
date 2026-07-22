const { variants } = require('./normalize.js');

const MAX_GUESS_LENGTH = 200; // guard against pathological input

// Edit-distance budget, keyed on the SHORTER of the two strings.
//
// Using the shorter length is the conservative choice: it stops a brief guess
// from fuzzing its way into a long alias. The ladder is tuned against real
// confusable city pairs -- Kanpur/Kannur (6, d2) and Lima/Lome (4, d2) must
// both be rejected, while Tokyo/Tokio (5, d1) and Kolkata/Kolkatta (7, d1)
// must be accepted.
function distanceBudget(len) {
  if (len <= 4) return 0;   // Pune/Puno, Bern/Bonn, Lima/Lome
  if (len <= 7) return 1;   // Kanpur/Kannur (d2) stays rejected
  if (len <= 11) return 2;
  return 3;
}

// Damerau-Levenshtein (optimal string alignment), with early abandonment once
// every cell in a row exceeds `cutoff`.
//
// The Damerau extension -- counting an adjacent transposition as ONE edit
// rather than two -- matters a great deal here. Transposition is the most
// common human typo, and plain Levenshtein scores "Anyuan" -> "Anuyan" as
// distance 2, pushing it outside the budget for a 6-character name. Widening
// the budget instead would have let genuinely different cities through.
function boundedLevenshtein(a, b, cutoff) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const m = a.length, n = b.length;
  let prev2 = new Array(n + 1);          // row i-2, for transpositions
  let prev = new Array(n + 1);           // row i-1
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cutoff) return cutoff + 1;
    const spare = prev2;
    prev2 = prev; prev = curr; curr = spare;
  }
  return prev[n];
}

/**
 * Precompute a grader for one city. Variant expansion happens once here, not
 * per guess, so grading a round is a cheap set lookup plus a bounded fuzzy
 * pass over a handful of aliases.
 */
function createCityMatcher(canonicalName, aliases = [], options = {}) {
  const { nameIndex = null, cityId = null } = options;
  const canonicalVariants = new Set(canonicalName ? variants(canonicalName) : []);
  const exact = new Set(canonicalVariants);
  const fuzzyTargets = []; // [{ variant, sourceName }]

  for (const name of [canonicalName, ...aliases].filter(Boolean)) {
    for (const v of variants(name)) {
      exact.add(v);
      fuzzyTargets.push({ variant: v, sourceName: name });
    }
  }

  return {
    canonicalName,
    aliasCount: aliases.length,
    variantCount: exact.size,

    /**
     * @returns {{correct: boolean, canonicalName: string|null,
     *            tier: 'exact'|'fuzzy'|null, distance: number|null,
     *            matchedName: string|null}}
     */
    grade(guess) {
      const miss = { correct: false, canonicalName: null, tier: null, distance: null, matchedName: null };
      if (typeof guess !== 'string') return miss;
      const trimmed = guess.trim();
      if (!trimmed || trimmed.length > MAX_GUESS_LENGTH) return miss;

      const guessVariants = [...variants(trimmed)];
      if (!guessVariants.length) return miss;

      // Tier 1: the guess IS this city's canonical name. Always wins, so a
      // homonym (two cities named Rajgarh) still accepts its own name.
      for (const gv of guessVariants) {
        if (canonicalVariants.has(gv)) {
          return { correct: true, canonicalName, tier: 'exact', distance: 0, matchedName: gv };
        }
      }

      // Tier 2: the guess is another city's canonical name. That names a
      // different real place, so it loses even if it also appears in this
      // city's inherited alias list.
      if (nameIndex) {
        for (const gv of guessVariants) {
          if (nameIndex.isForeignCanonical(gv, cityId)) return miss;
        }
      }

      // Tier 3: exact match on one of this city's aliases.
      for (const gv of guessVariants) {
        if (exact.has(gv)) {
          return { correct: true, canonicalName, tier: 'exact', distance: 0, matchedName: gv };
        }
      }

      // Tier 4: the guess exactly names some other real city (by alias). A
      // wrong answer, not a typo -- so this is checked before fuzzy, which is
      // how Kanpur/Kannur stay separated without a punitive distance budget.
      if (nameIndex) {
        for (const gv of guessVariants) {
          if (nameIndex.isForeignCity(gv, cityId)) return miss;
        }
      }

      // Tier 2: bounded fuzzy. Take the closest match across all pairings.
      let best = null;
      for (const gv of guessVariants) {
        const budget = distanceBudget(gv.length);
        if (budget === 0) continue;
        for (const target of fuzzyTargets) {
          const pairBudget = Math.min(budget, distanceBudget(Math.min(gv.length, target.variant.length)));
          if (pairBudget === 0) continue;
          const d = boundedLevenshtein(gv, target.variant, pairBudget);
          if (d <= pairBudget && (!best || d < best.distance)) {
            best = { distance: d, matchedName: target.sourceName };
            if (d === 1) break;
          }
        }
        if (best && best.distance === 1) break;
      }

      if (best) {
        return {
          correct: true, canonicalName, tier: 'fuzzy',
          distance: best.distance, matchedName: best.matchedName,
        };
      }
      return miss;
    },
  };
}

/** Build a matcher straight from a cities.sqlite row. */
function createMatcherFromRow(row, nameIndex = null) {
  let aliases = [];
  try {
    aliases = JSON.parse(row.aliases_json || '[]');
  } catch { /* corrupt alias blob -- canonical name still grades */ }
  return createCityMatcher(row.canonical_name, aliases, { nameIndex, cityId: row.id });
}

module.exports = { createCityMatcher, createMatcherFromRow, boundedLevenshtein, distanceBudget };
