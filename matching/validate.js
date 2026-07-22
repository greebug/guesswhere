// Validates the matcher against the real cities.sqlite corpus rather than
// fixtures. Fixtures prove the logic; this measures the behaviour that
// actually matters -- how often it accepts a wrong city, and how often it
// forgives a genuine typo.
const { DatabaseSync } = require('node:sqlite');
const { createNameIndex } = require('./name-index.js');
const { createMatcherFromRow } = require('./match.js');

const DB = process.argv[2] || '../etl/cities.sqlite';

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function typo(name, rand) {
  const chars = [...name];
  const letters = chars.map((c, i) => [c, i]).filter(([c]) => /\p{L}/u.test(c));
  if (letters.length < 2) return null;
  const [, i] = letters[Math.floor(rand() * letters.length)];
  const mode = Math.floor(rand() * 3);
  if (mode === 0) { chars.splice(i, 1); }                                  // deletion
  else if (mode === 1) { chars.splice(i, 0, chars[i]); }                   // doubling
  else if (i + 1 < chars.length) { [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]]; } // transpose
  const out = chars.join('');
  return out === name ? null : out;
}

const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare('SELECT id, canonical_name, aliases_json, country, pop_ghsl FROM cities WHERE quarantined=0').all();
console.log(`corpus: ${rows.length} playable cities`);

const t0 = Date.now();
const idx = createNameIndex(rows);
console.log(`name index: ${idx.size} distinct normalized variants (${Date.now() - t0}ms)\n`);

const matchers = new Map();
for (const r of rows) matchers.set(r.id, createMatcherFromRow(r, idx));

// --- 1. Every city must accept its own canonical name -----------------------
let selfFail = [];
for (const r of rows) {
  if (!matchers.get(r.id).grade(r.canonical_name).correct) selfFail.push(r.canonical_name);
}
console.log(`1. self-acceptance:      ${rows.length - selfFail.length}/${rows.length} accept their own canonical name`);
if (selfFail.length) console.log(`   FAILURES: ${selfFail.slice(0, 10).join(', ')}`);

// --- 2. Every city must accept each of its own aliases ----------------------
let aliasTotal = 0, aliasFail = 0;
const aliasFailures = [];
for (const r of rows) {
  const m = matchers.get(r.id);
  for (const a of JSON.parse(r.aliases_json || '[]')) {
    aliasTotal++;
    if (!m.grade(a).correct) { aliasFail++; if (aliasFailures.length < 10) aliasFailures.push(`${r.canonical_name} <- "${a}"`); }
  }
}
console.log(`2. alias acceptance:     ${aliasTotal - aliasFail}/${aliasTotal} (${(100 * (aliasTotal - aliasFail) / aliasTotal).toFixed(2)}%)`);
if (aliasFailures.length) console.log(`   examples rejected: ${aliasFailures.join(' | ')}`);

// --- 3. FALSE ACCEPTS: other cities' names must be rejected -----------------
// The headline safety number. For each sampled city, try the canonical names
// of many other cities and count how many are wrongly accepted.
const rand = seededRng(7);
const sample = rows.slice().sort(() => rand() - 0.5).slice(0, 600);
let trials = 0, falseAccepts = 0;
const faExamples = [];
for (const r of sample) {
  const m = matchers.get(r.id);
  for (let k = 0; k < 60; k++) {
    const other = rows[Math.floor(rand() * rows.length)];
    if (other.id === r.id) continue;
    trials++;
    const res = m.grade(other.canonical_name);
    if (res.correct) {
      falseAccepts++;
      if (faExamples.length < 15) {
        faExamples.push(`"${other.canonical_name}" (${other.country}) accepted as "${r.canonical_name}" (${r.country}) [${res.tier} d=${res.distance}]`);
      }
    }
  }
}
console.log(`3. false-accept rate:    ${falseAccepts}/${trials} (${(100 * falseAccepts / trials).toFixed(4)}%)`);
for (const e of faExamples) console.log(`   ${e}`);

// --- 4. Typo tolerance ------------------------------------------------------
let typoTotal = 0, typoOk = 0;
const typoMiss = [];
for (const r of sample) {
  const m = matchers.get(r.id);
  for (let k = 0; k < 4; k++) {
    const t = typo(r.canonical_name, rand);
    if (!t) continue;
    typoTotal++;
    if (m.grade(t).correct) typoOk++;
    else if (typoMiss.length < 12) typoMiss.push(`"${t}" not accepted for "${r.canonical_name}"`);
  }
}
console.log(`\n4. typo tolerance:       ${typoOk}/${typoTotal} (${(100 * typoOk / typoTotal).toFixed(1)}%) single-edit typos forgiven`);
for (const e of typoMiss.slice(0, 6)) console.log(`   ${e}`);

// --- 5. Performance ---------------------------------------------------------
const perfCity = matchers.get(sample[0].id);
const t1 = Date.now();
const N = 20000;
for (let i = 0; i < N; i++) perfCity.grade('Springfeild');
console.log(`\n5. performance:          ${(N / ((Date.now() - t1) / 1000) / 1000).toFixed(0)}k grades/sec (worst case: no match, full fuzzy scan)`);
