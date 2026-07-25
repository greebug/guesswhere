// Checks the eliminated-country hint layer end to end against a running server:
//
//   VERIFY_BASE_URL=http://localhost:3000/guesswhere node scripts/verify-eliminated.mjs
//
// The base URL needs the /guesswhere prefix -- next.config.ts's basePath means
// every route lives under it (see CLAUDE.md's domain-migration notes).
//
// * a correct guess answers with "City, Country", not a bare city name
// * /eliminated lists exactly the settled rounds' countries and nothing else
//   -- an unsettled round's country leaking would be a straight spoiler
// * every listed country resolves to a real polygon (or is one of the handful
//   Natural Earth folds into a parent, which must 404 rather than mis-tint)
// * round selection never repeats a country, including across the corpus's
//   duplicate country spellings ("United States" vs "United States of
//   America") that the raw-string key used to miss
//
// Like the other scripts here it reads cities.sqlite directly to look up the
// answers -- the API never exposes them, which is the point.

import { DatabaseSync } from 'node:sqlite';
import { BASE, CITIES_DB, GAME_DB } from './env.mjs';

const db = new DatabaseSync(CITIES_DB, { readOnly: true });

/** The API never hands back a round's cityId -- that IS the answer -- so the
 * answers come out of the game DB the same way verify-game.mjs gets them. */
function rawSession(gameId) {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT data FROM games WHERE id = ?').get(gameId);
  gdb.close();
  return JSON.parse(row.data);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

const cityStmt = db.prepare('SELECT canonical_name, country, iso2 FROM cities WHERE id = ?');

async function json(path, init) {
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

async function post(path, body) {
  return json(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// The corpus's two upstream name sources disagree on 31 countries; this is the
// same fallback the server uses for the 92 cities carrying no iso2 at all.
const NULL_ISO_FALLBACK = {
  'China, Taiwan Province of China': 'TW',
  Congo: 'CG',
  "Dem. People's Republic of Korea": 'KP',
  'Democratic Republic of the Congo': 'CD',
  Myanmar: 'MM',
  'Republic of Korea': 'KR',
  'Russian Federation': 'RU',
  'State of Palestine': 'PS',
  'United Republic of Tanzania': 'TZ',
  'United States of America': 'US',
  'Viet Nam': 'VN',
};
const keyFor = (city) => city.iso2 ?? NULL_ISO_FALLBACK[city.country] ?? city.country;

async function main() {
  console.log(`\nbase: ${BASE}\n`);

  console.log('game: country on a correct guess, and the eliminated list');
  const created = await post('/api/game/new', { targetPopulation: 500000, onlyCoast: false });
  const gameId = created.body.gameId;
  check('created a game', !!gameId, JSON.stringify(created.body).slice(0, 120));

  const answers = rawSession(gameId).rounds.map((r) => cityStmt.get(r.cityId));

  // Nothing settled yet -- nothing may be eliminated.
  const emptyList = (await json(`/api/game/${gameId}/eliminated`)).body;
  check('no countries eliminated before any round settles', emptyList.countries.length === 0);

  // Solve round 3 and reveal round 6; leave the rest open.
  const solved = await post(`/api/game/${gameId}/guess`, {
    roundIndex: 3,
    guess: answers[3].canonical_name,
  });
  check('round 3 graded correct', solved.body.correct === true);
  check(
    'correct guess answers "City, Country"',
    solved.body.canonicalName === `${answers[3].canonical_name}, ${answers[3].country}`,
    solved.body.canonicalName
  );

  const revealed = await post(`/api/game/${gameId}/reveal`, { roundIndex: 6 });
  check(
    'reveal still answers "City, Country"',
    revealed.body.canonicalName === `${answers[6].canonical_name}, ${answers[6].country}`,
    revealed.body.canonicalName
  );

  const refetched = (await json(`/api/game/${gameId}`)).body;
  check(
    'the solved round keeps its country across a reload',
    refetched.rounds[3].canonicalName === solved.body.canonicalName
  );

  const list = (await json(`/api/game/${gameId}/eliminated`)).body.countries;
  const expected = new Set([keyFor(answers[3]), keyFor(answers[6])]);
  const got = new Set(list.map((c) => c.iso2));
  check(
    'eliminated lists exactly the solved and revealed rounds',
    got.size === expected.size && [...expected].every((iso) => got.has(iso)),
    `expected ${[...expected]} got ${[...got]}`
  );

  const unsettledIsos = answers
    .filter((_, i) => i !== 3 && i !== 6)
    .map(keyFor)
    .filter((iso) => !expected.has(iso));
  check(
    'no unsettled round has its country exposed',
    unsettledIsos.every((iso) => !got.has(iso)),
    `leaked ${unsettledIsos.filter((iso) => got.has(iso))}`
  );

  for (const country of list) {
    const shape = await json(`/api/geo/shape?iso=${country.iso2}`);
    check(
      `shape for ${country.iso2} (${country.name}) resolves or 404s cleanly`,
      (shape.status === 200 && shape.body.geometry.type === 'MultiPolygon') ||
        shape.status === 404,
      `status ${shape.status}`
    );
  }

  console.log('\nselection: one country per game, across duplicate spellings');
  const TRIALS = 40;
  let dupes = 0;
  let example = '';
  for (let i = 0; i < TRIALS; i++) {
    const g = (await post('/api/game/new', { targetPopulation: 50000, onlyCoast: false })).body;
    const full = rawSession(g.gameId);
    const keys = full.rounds.map((r) => keyFor(cityStmt.get(r.cityId)));
    if (new Set(keys).size !== keys.length) {
      dupes++;
      if (!example) {
        example = full.rounds
          .map((r) => {
            const c = cityStmt.get(r.cityId);
            return `${c.canonical_name} [${c.country}/${keyFor(c)}]`;
          })
          .join(', ');
      }
    }
  }
  check(`${TRIALS} games at a 50,000 floor, no repeated country`, dupes === 0, example);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
