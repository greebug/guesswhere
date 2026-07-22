function normalize(s) {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// 1.0 = exact match after normalization, 0 = nothing in common.
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (!na.length || !nb.length) return 0;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// Best similarity between candidateName and any of GHSL's ';'-separated names.
function bestSimilarityAgainstList(candidateName, semicolonList) {
  if (!candidateName || !semicolonList) return 0;
  let best = 0;
  for (const name of semicolonList.split(';')) {
    const s = similarity(candidateName, name.trim());
    if (s > best) best = s;
  }
  return best;
}

// Best similarity between GHSL's name list and a tile feature's name fields.
// `name` alone fails for non-Latin-script countries (China, Japan, Korea,
// Arabic script, etc.) where OSM's `name` is in the local script but
// `name:en` carries the Latin exonym used by GHSL/GeoNames.
function bestNameFieldScore(props, semicolonList) {
  let best = 0;
  for (const field of [props.name, props['name:en']]) {
    if (!field) continue;
    const s = bestSimilarityAgainstList(field, semicolonList);
    if (s > best) best = s;
  }
  return best;
}

module.exports = { normalize, levenshtein, similarity, bestSimilarityAgainstList, bestNameFieldScore };
