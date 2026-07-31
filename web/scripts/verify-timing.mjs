// Verifies the pause accounting added alongside the "record it, don't rank it"
// decision: wall-clock start, paused time, and the guarantee that NEITHER
// changes what the leaderboard does.
//
// The property that matters most here is a negative one -- existing records
// must keep their exact positions and their exact total_ms. Rows written
// before these columns existed carry NULL, and NULL must survive the round
// trip to the API as null, not as 0: "not recorded" and "never paused" are
// different claims and only one of them is true of an old row.
//
// Run the dev server first, then:  node scripts/verify-timing.mjs
import { DatabaseSync } from 'node:sqlite';
import { GAME_DB, CITIES_DB, makeClient, sleep, makeChecker } from './env.mjs';

const { check, finish } = makeChecker();

function answersFor(gameId) {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT data FROM games WHERE id = ?').get(gameId);
  gdb.close();
  const session = JSON.parse(row.data);
  const cdb = new DatabaseSync(CITIES_DB, { readOnly: true });
  const names = session.rounds.map((r) => {
    const c = cdb.prepare('SELECT canonical_name FROM cities WHERE id = ?').get(r.cityId);
    return c.canonical_name;
  });
  cdb.close();
  return { session, names };
}

const rawSession = (gameId) => {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT data FROM games WHERE id = ?').get(gameId);
  gdb.close();
  return JSON.parse(row.data);
};

const resultRow = (id) => {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT * FROM game_results WHERE id = ?').get(id);
  gdb.close();
  return row;
};

const stamp = Date.now().toString(36);
const user = makeClient();
const username = `timing_${stamp}`;
await user('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'correct-horse' }),
});

// ===========================================================================
console.log('\n=== 1. Schema migration is additive ===');
{
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const cols = gdb.prepare('PRAGMA table_info(game_results)').all();
  gdb.close();
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
  check('started_at column exists', !!byName.started_at);
  check('paused_ms column exists', !!byName.paused_ms);
  check('started_at is nullable', byName.started_at?.notnull === 0);
  check('paused_ms is nullable', byName.paused_ms?.notnull === 0);
  check('total_ms is untouched and still NOT NULL', byName.total_ms?.notnull === 1);
}

// ===========================================================================
console.log('\n=== 2. Parking on a settled round stops the clock and banks pause ===');
let r = await user('/api/game/new', {
  method: 'POST',
  body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
});
const gameId = r.body.gameId;
const { names } = answersFor(gameId);

// Round 0: land on it, sit a moment, solve it.
await user(`/api/game/${gameId}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
await sleep(1100);
await user(`/api/game/${gameId}/guess`, {
  method: 'POST',
  body: JSON.stringify({ roundIndex: 0, guess: names[0] }),
});
const afterSolve = rawSession(gameId);
const round0Ms = afterSolve.rounds[0].elapsedMs;
const pausedAfterSolve = afterSolve.pausedMs ?? 0;
check('round 0 accrued real time', round0Ms >= 1000, `${round0Ms}ms`);

// Now park on the SOLVED round and heartbeat -- this is the exploit shape.
await user(`/api/game/${gameId}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
await sleep(1200);
await user(`/api/game/${gameId}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
const parked = rawSession(gameId);

check(
  'solved round accrues NOTHING while parked on it',
  parked.rounds[0].elapsedMs === round0Ms,
  `${round0Ms} -> ${parked.rounds[0].elapsedMs}`
);
check(
  'no other round accrued either',
  parked.rounds.slice(1).every((x) => x.elapsedMs === 0)
);
check(
  'the parked interval is banked as pausedMs',
  (parked.pausedMs ?? 0) - pausedAfterSolve >= 1000,
  `delta ${(parked.pausedMs ?? 0) - pausedAfterSolve}ms`
);

// And an UNSETTLED round must not bank pause -- that time is charged, not paused.
await user(`/api/game/${gameId}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 1 }) });
const beforeActive = rawSession(gameId);
await sleep(1100);
await user(`/api/game/${gameId}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 1 }) });
const afterActive = rawSession(gameId);
check(
  'an unsettled round on screen charges the round',
  afterActive.rounds[1].elapsedMs >= 1000,
  `${afterActive.rounds[1].elapsedMs}ms`
);
check(
  'and banks (almost) no pause',
  (afterActive.pausedMs ?? 0) - (beforeActive.pausedMs ?? 0) < 200,
  `delta ${(afterActive.pausedMs ?? 0) - (beforeActive.pausedMs ?? 0)}ms`
);

// ===========================================================================
console.log('\n=== 3. Finish it: the snapshot carries both new fields ===');
for (let i = 1; i < names.length; i++) {
  await user(`/api/game/${gameId}/focus`, {
    method: 'POST',
    body: JSON.stringify({ roundIndex: i }),
  });
  await user(`/api/game/${gameId}/guess`, {
    method: 'POST',
    body: JSON.stringify({ roundIndex: i, guess: names[i] }),
  });
}
const row = resultRow(gameId);
check('a result row was written', !!row);
check('started_at is recorded', typeof row.started_at === 'number' && row.started_at > 0);
check('paused_ms is recorded', typeof row.paused_ms === 'number');
check('paused_ms reflects the parked interval', row.paused_ms >= 1000, `${row.paused_ms}ms`);
check(
  'wall clock >= active time',
  row.finished_at - row.started_at >= row.total_ms,
  `wall ${row.finished_at - row.started_at} vs active ${row.total_ms}`
);
check(
  'total_ms is still the sum of the rounds, unchanged by any of this',
  row.total_ms === JSON.parse(row.rounds_json).reduce((s, x) => s + x.ms, 0)
);
check(
  'paused time is NOT added to total_ms',
  row.total_ms < row.finished_at - row.started_at,
  'ranking must not absorb the pause'
);

// ===========================================================================
console.log('\n=== 4. The result API exposes them, and NULL stays null ===');
r = await user(`/api/result/${gameId}`);
check('result API returns 200', r.status === 200);
check('startedAt is exposed', r.body.startedAt === row.started_at);
check('pausedMs is exposed', r.body.pausedMs === row.paused_ms);
check('totalMs is unchanged', r.body.totalMs === row.total_ms);

// Simulate a pre-migration row: null both columns, confirm nothing breaks and
// null survives to the client as null rather than being coerced to 0.
{
  const gdb = new DatabaseSync(GAME_DB);
  gdb.prepare('UPDATE game_results SET started_at = NULL, paused_ms = NULL WHERE id = ?').run(gameId);
  gdb.close();
  r = await user(`/api/result/${gameId}`);
  check('legacy row (NULL columns) still returns 200', r.status === 200);
  check('startedAt comes back as null, not 0', r.body.startedAt === null);
  check('pausedMs comes back as null, not 0', r.body.pausedMs === null);
  check('legacy row keeps its total_ms', r.body.totalMs === row.total_ms);
  // Put it back so the leaderboard check below sees the real values.
  const gdb2 = new DatabaseSync(GAME_DB);
  gdb2
    .prepare('UPDATE game_results SET started_at = ?, paused_ms = ? WHERE id = ?')
    .run(row.started_at, row.paused_ms, gameId);
  gdb2.close();
}

// ===========================================================================
console.log('\n=== 5. Ranking is untouched ===');
r = await user('/api/leaderboard');
const board = JSON.stringify(r.body);
check('leaderboard still responds', r.status === 200);
check(
  'leaderboard payload exposes no pause/wall-clock field',
  !/pausedMs|startedAt|paused_ms|started_at/.test(board),
  'ranking must not start depending on these'
);
{
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const ordered = gdb
    .prepare(
      `SELECT id FROM game_results WHERE target_population = 500000 AND only_coast = 0
         AND eligible = 1 ORDER BY total_ms ASC LIMIT 5`
    )
    .all()
    .map((x) => x.id);
  gdb.close();
  const served = (r.body.boards.find((b) => b.population === 500000 && !b.onlyCoast)?.entries ?? [])
    .map((e) => e.id);
  check(
    'served board matches a plain ORDER BY total_ms, id for id',
    JSON.stringify(served) === JSON.stringify(ordered),
    `served ${JSON.stringify(served)} vs total_ms order ${JSON.stringify(ordered)}`
  );
  check('board entries are sorted ascending by total_ms', (() => {
    const times = (r.body.boards.find((b) => b.population === 500000 && !b.onlyCoast)?.entries ?? [])
      .map((e) => e.total_ms);
    return times.every((t, i) => i === 0 || times[i - 1] <= t);
  })());
}

// The finished game paused for >1.5s. If pause were ever folded into ranking,
// this row's total_ms would have moved. Assert the exact number the board
// serves, not just its position.
check(
  'the paused run is ranked on its ACTIVE time, not its wall clock',
  (r.body.boards.find((b) => b.population === 500000 && !b.onlyCoast)?.entries ?? [])
    .find((e) => e.id === gameId)?.total_ms === row.total_ms,
  `expected ${row.total_ms}`
);

finish();
