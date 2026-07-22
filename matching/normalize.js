// Normalization for guess grading.
//
// Design note: we generate a SET of variant forms per string rather than
// collapsing to one canonical form. That lets "广州市" match "广州" and
// "Frankfurt am Main" match "Frankfurt" without a destructive rewrite that
// might merge two genuinely different names.

// Latin administrative suffixes/qualifiers players routinely omit.
const TRAILING_WORDS = [
  'city', 'town', 'municipality', 'district', 'county', 'prefecture',
  'shi', 'si', 'ken', 'gun', 'ku', 'cho', 'machi',
  'oblast', 'raion', 'rayon', 'governorate', 'province', 'region',
];
// CJK administrative suffix characters: 市 (city), 县/縣 (county),
// 区/區 (district), 镇/鎮 (town), 州 (prefecture), 村 (village).
const CJK_SUFFIX = /[市县縣区區镇鎮州村]+$/;

// Leading articles/qualifiers. Arabic al-/ad-/as- assimilate to the following
// consonant, so "Ad Diwem" and "Al Diwem" are the same name.
const LEADING_WORDS = [
  'the', 'la', 'le', 'les', 'el', 'al', 'ad', 'as', 'ar', 'az', 'ash', 'an',
  'ciudad', 'ciudad de', 'cidade de', 'villa', 'vila', 'kota', 'thanh pho',
];

function stripDiacritics(s) {
  // Decompose, then drop combining marks. Handles é->e, ā->a, ṭ->t, etc.
  return s.normalize('NFKD').replace(/\p{M}+/gu, '');
}

// Base normalization, script-preserving: unlike a naive [^a-z0-9] filter,
// this keeps CJK/Cyrillic/Arabic/Devanagari letters intact so a player can
// type the local-script name.
function normalizeBase(s) {
  if (!s) return '';
  return stripDiacritics(
    s
      .replace(/[’‘‛`´]/g, "'")
      .replace(/[–—―]/g, '-')
      .replace(/[ʻʼʾʿ‛]/g, "'")
  )
    .toLowerCase()
    .replace(/['ʼ]/g, '')          // drop apostrophes entirely: xi'an -> xian
    .replace(/[^\p{L}\p{N}]+/gu, ' ')   // any script's letters/digits survive
    .trim()
    .replace(/\s+/g, ' ');
}

function stripLeading(s) {
  const words = s.split(' ');
  for (let take = 2; take >= 1; take--) {
    if (words.length > take) {
      const head = words.slice(0, take).join(' ');
      if (LEADING_WORDS.includes(head)) return words.slice(take).join(' ');
    }
  }
  return s;
}

function stripTrailing(s) {
  const words = s.split(' ');
  if (words.length > 1 && TRAILING_WORDS.includes(words[words.length - 1])) {
    return words.slice(0, -1).join(' ');
  }
  return s;
}

// "st petersburg" / "saint petersburg" / "sankt petersburg" -> one form.
function normalizeSaint(s) {
  return s.replace(/\b(saint|sankt|sint|szent|sao|san to)\b/g, 'st');
}

// All forms a string may legitimately be typed as. Matching succeeds if any
// variant of the guess equals any variant of an alias.
function variants(s) {
  const out = new Set();
  const base = normalizeBase(s);
  if (!base) return out;

  const seeds = new Set([base, normalizeSaint(base)]);
  for (const seed of seeds) {
    out.add(seed);
    const cjk = seed.replace(CJK_SUFFIX, '');
    if (cjk && cjk !== seed) out.add(cjk);

    for (const form of [seed, cjk].filter(Boolean)) {
      const noLead = stripLeading(form);
      const noTrail = stripTrailing(form);
      const neither = stripTrailing(stripLeading(form));
      for (const v of [noLead, noTrail, neither]) if (v) out.add(v);
    }
  }
  out.delete('');
  return out;
}

module.exports = { normalizeBase, variants, stripDiacritics };
