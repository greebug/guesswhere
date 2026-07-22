const test = require('node:test');
const assert = require('node:assert');
const { createCityMatcher } = require('./match.js');
const { createNameIndex } = require('./name-index.js');

// ---------------------------------------------------------------------------
// Fixtures modelled on real cities.sqlite rows. A shared name index stands in
// for the full 11k-city table so the cross-city collision guard is exercised.
// ---------------------------------------------------------------------------
const ROWS = [
  { id: 1, canonical_name: 'Kolkata', aliases_json: JSON.stringify(['Calcutta', 'Kolkatha', 'Kalikata', 'কলকাতা', 'Kalkutta']) },
  { id: 2, canonical_name: 'Ho Chi Minh City', aliases_json: JSON.stringify(['Saigon', 'Sai Gon', 'Thành phố Hồ Chí Minh', 'Ho Chi Minh']) },
  { id: 3, canonical_name: "Xi'an", aliases_json: JSON.stringify(['西安市', 'Xian', 'Sian', 'Hsi-an']) },
  { id: 4, canonical_name: 'Munich', aliases_json: JSON.stringify(['München', 'Muenchen', 'Monaco di Baviera', 'Мюнхен']) },
  { id: 5, canonical_name: 'Guangzhou', aliases_json: JSON.stringify(['广州市', 'Canton', 'Kanton']) },
  { id: 6, canonical_name: 'Saint Petersburg', aliases_json: JSON.stringify(['Sankt-Peterburg', 'Leningrad']) },
  { id: 7, canonical_name: "Qal'at Mgouna", aliases_json: JSON.stringify(['Kalaat Mgouna', 'قلعة مكونة']) },
  { id: 8, canonical_name: 'Ad Diwem', aliases_json: JSON.stringify(['Ed Dueim', 'El Dueim']) },
  { id: 9, canonical_name: 'Kanpur', aliases_json: JSON.stringify(['Cawnpore', 'कानपुर']) },
  { id: 10, canonical_name: 'Lima', aliases_json: JSON.stringify(['Ciudad de Lima']) },
  { id: 11, canonical_name: 'Bern', aliases_json: JSON.stringify(['Berne', 'Berna']) },
  { id: 12, canonical_name: 'Pune', aliases_json: JSON.stringify(['Poona', 'पुणे']) },
  { id: 13, canonical_name: 'Vienna', aliases_json: JSON.stringify(['Wien', 'Viena']) },
  { id: 14, canonical_name: 'Tokyo', aliases_json: JSON.stringify(['東京', 'Tōkyō', 'Tokio']) },
  // Cities that exist only to collide with the ones above.
  { id: 20, canonical_name: 'Kannur', aliases_json: '[]' },
  { id: 21, canonical_name: 'Lome', aliases_json: '[]' },
  { id: 22, canonical_name: 'Bonn', aliases_json: '[]' },
  { id: 23, canonical_name: 'Puno', aliases_json: '[]' },
  { id: 24, canonical_name: 'Vienne', aliases_json: '[]' },
  { id: 25, canonical_name: 'Howrah', aliases_json: '[]' },
  { id: 26, canonical_name: 'Dongguan', aliases_json: '[]' },
  { id: 27, canonical_name: 'Mumbai', aliases_json: '[]' },
  { id: 28, canonical_name: 'Shenzhen', aliases_json: '[]' },
];
const IDX = createNameIndex(ROWS);
const make = id => {
  const row = ROWS.find(r => r.id === id);
  return createCityMatcher(row.canonical_name, JSON.parse(row.aliases_json),
    { nameIndex: IDX, cityId: row.id });
};

const kolkata = make(1);
const hcmc = make(2);
const xian = make(3);
const munich = make(4);
const guangzhou = make(5);
const stPetersburg = make(6);
const mgouna = make(7);
const adDiwem = make(8);
const kanpur = make(9);
const lima = make(10);
const bern = make(11);
const pune = make(12);
const vienna = make(13);
const tokyo = make(14);

// ---------------------------------------------------------------------------
// MUST ACCEPT -- the tolerance the game promises.
// ---------------------------------------------------------------------------
test('exact canonical name', () => {
  assert.equal(kolkata.grade('Kolkata').correct, true);
  assert.equal(munich.grade('Munich').correct, true);
});

test('case and surrounding whitespace are ignored', () => {
  assert.equal(kolkata.grade('  KOLKATA  ').correct, true);
  assert.equal(munich.grade('mUnIcH').correct, true);
});

test('historical and alternate names', () => {
  assert.equal(kolkata.grade('Calcutta').correct, true);
  assert.equal(hcmc.grade('Saigon').correct, true);
  assert.equal(guangzhou.grade('Canton').correct, true);
  assert.equal(kanpur.grade('Cawnpore').correct, true);
  assert.equal(pune.grade('Poona').correct, true);
});

test('diacritics may be omitted', () => {
  assert.equal(munich.grade('Munchen').correct, true);
  assert.equal(munich.grade('München').correct, true);
  assert.equal(tokyo.grade('Tokyo').correct, true);
  assert.equal(tokyo.grade('Tōkyō').correct, true);
});

test('apostrophe styles and omission', () => {
  assert.equal(xian.grade("Xi'an").correct, true);
  assert.equal(xian.grade('Xi’an').correct, true);   // curly
  assert.equal(xian.grade('Xian').correct, true);
  assert.equal(mgouna.grade('Qalat Mgouna').correct, true);
});

test('local-script names are accepted', () => {
  assert.equal(xian.grade('西安市').correct, true);
  assert.equal(tokyo.grade('東京').correct, true);
  assert.equal(munich.grade('Мюнхен').correct, true);
  assert.equal(kolkata.grade('কলকাতা').correct, true);
});

test('CJK administrative suffix may be omitted', () => {
  assert.equal(xian.grade('西安').correct, true);        // 西安市 minus 市
  assert.equal(guangzhou.grade('广州').correct, true);
});

test('Latin administrative qualifier may be omitted', () => {
  assert.equal(hcmc.grade('Ho Chi Minh').correct, true);
});

test('saint abbreviations', () => {
  assert.equal(stPetersburg.grade('St Petersburg').correct, true);
  assert.equal(stPetersburg.grade('St. Petersburg').correct, true);
  assert.equal(stPetersburg.grade('Saint Petersburg').correct, true);
});

test('leading article variation (Arabic al-/ad-/el-)', () => {
  assert.equal(adDiwem.grade('Diwem').correct, true);
  assert.equal(adDiwem.grade('Ed Dueim').correct, true);
});

test('single-character typos on medium names', () => {
  assert.equal(kolkata.grade('Kolkatta').correct, true);
  assert.equal(kolkata.grade('Kolkatha').correct, true);
  assert.equal(guangzhou.grade('Guangzhuo').correct, true);
  assert.equal(tokyo.grade('Tokio').correct, true);
});

test('transpositions cost one edit, not two (Damerau)', () => {
  // The most common human typo. Plain Levenshtein scores these as distance 2,
  // which would push them outside the budget for a short name.
  assert.equal(guangzhou.grade('Guangzhuo').correct, true);
  assert.equal(kolkata.grade('Kolkaat').correct, true);
  assert.equal(munich.grade('Muncih').correct, true);
});

test("another city's canonical name loses to an inherited alias", () => {
  // GeoNames alias lists occasionally carry a neighbouring city's real name.
  // Guessing that name should credit THAT city, not this one.
  const rows = [
    { id: 200, canonical_name: 'Dayu', aliases_json: JSON.stringify(["Nan'an"]) },
    { id: 201, canonical_name: "Nan'an", aliases_json: '[]' },
  ];
  const idx = createNameIndex(rows);
  const dayu = createCityMatcher('Dayu', ["Nan'an"], { nameIndex: idx, cityId: 200 });
  const nanan = createCityMatcher("Nan'an", [], { nameIndex: idx, cityId: 201 });
  assert.equal(dayu.grade("Nan'an").correct, false);
  assert.equal(nanan.grade("Nan'an").correct, true);
  assert.equal(dayu.grade('Dayu').correct, true);
});

test('reports the canonical spelling on success', () => {
  const r = kolkata.grade('calcutta');
  assert.equal(r.correct, true);
  assert.equal(r.canonicalName, 'Kolkata');
});

// ---------------------------------------------------------------------------
// MUST REJECT -- genuinely different cities that sit close in edit distance.
// These are the cases that make a naive fuzzy matcher unusable.
// ---------------------------------------------------------------------------
test('rejects distinct cities with small edit distance', () => {
  // Kanpur/Kannur are ONE edit apart, as are Pune/Puno and Vienna/Vienne.
  // No threshold can separate these from ordinary typos -- they are rejected
  // by the cross-city name index, not by the distance budget.
  assert.equal(kanpur.grade('Kannur').correct, false);   // both India, d=1
  assert.equal(pune.grade('Puno').correct, false);       // India vs Peru, d=1
  assert.equal(vienna.grade('Vienne').correct, false);   // Austria vs France, d=1
  assert.equal(lima.grade('Lome').correct, false);       // Peru vs Togo, d=2
  assert.equal(bern.grade('Bonn').correct, false);       // d=2
  assert.equal(lima.grade('Lima Peru').correct, false);  // extra token
});

test('collision guard does not block a city from its own name', () => {
  // "Lima" is indexed as a real city; grading Lima must still accept it.
  assert.equal(lima.grade('Lima').correct, true);
  assert.equal(bern.grade('Bern').correct, true);
  assert.equal(vienna.grade('Vienna').correct, true);
});

test('shared names resolve in favour of the city being graded', () => {
  // Several real cities share a name (Springfield, Tripoli, Santiago). The
  // index maps a name to ALL its owners, so an owner is never blocked.
  const rows = [
    { id: 100, canonical_name: 'Springfield', aliases_json: '[]' },
    { id: 101, canonical_name: 'Springfield', aliases_json: '[]' },
  ];
  const idx = createNameIndex(rows);
  const a = createCityMatcher('Springfield', [], { nameIndex: idx, cityId: 100 });
  const b = createCityMatcher('Springfield', [], { nameIndex: idx, cityId: 101 });
  assert.equal(a.grade('Springfield').correct, true);
  assert.equal(b.grade('Springfield').correct, true);
});

test('short names require exact match', () => {
  assert.equal(bern.grade('Barn').correct, false);
  assert.equal(pune.grade('Pane').correct, false);
  assert.equal(lima.grade('Lame').correct, false);
});

test('rejects unrelated names', () => {
  assert.equal(kolkata.grade('Mumbai').correct, false);
  assert.equal(munich.grade('Berlin').correct, false);
  assert.equal(guangzhou.grade('Shenzhen').correct, false);
  assert.equal(vienna.grade('Budapest').correct, false);
});

test('rejects absorbed neighbouring cities (not aliases of this place)', () => {
  // Regression guard: GHSL's nameList merges satellite settlements into one
  // urban centre. Those must never have become aliases -- "Howrah" is a
  // different city from Kolkata, and accepting it would be a wrong answer.
  assert.equal(kolkata.grade('Howrah').correct, false);
  assert.equal(guangzhou.grade('Dongguan').correct, false);
});

test('rejects empty and junk input', () => {
  assert.equal(kolkata.grade('').correct, false);
  assert.equal(kolkata.grade('   ').correct, false);
  assert.equal(kolkata.grade('!!!').correct, false);
  assert.equal(kolkata.grade(null).correct, false);
  assert.equal(kolkata.grade(undefined).correct, false);
  assert.equal(kolkata.grade(12345).correct, false);
  assert.equal(kolkata.grade('k'.repeat(500)).correct, false);
});

test('rejects single letters and fragments', () => {
  assert.equal(kolkata.grade('K').correct, false);
  assert.equal(kolkata.grade('Kol').correct, false);
  assert.equal(munich.grade('Mun').correct, false);
});

test('does not leak the answer on an incorrect guess', () => {
  const r = kolkata.grade('Mumbai');
  assert.equal(r.correct, false);
  assert.equal(r.canonicalName, null);
  assert.equal(r.matchedName, null);
});
