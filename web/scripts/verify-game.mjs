// End-to-end verification of accounts, active-time accrual, and leaderboards.
// Runs against the live dev server; reads the two SQLite files directly only
// to look up answers (the API never exposes them, which is the point).
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

function rawSession(gameId) {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT data FROM games WHERE id = ?').get(gameId);
  gdb.close();
  return JSON.parse(row.data);
}

const stamp = Date.now().toString(36);

// ===========================================================================
console.log('\n=== 1. Accounts ===');
const alice = makeClient();
const username = `alice_${stamp}`;

let r = await alice('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'correct-horse' }),
});
check('signup succeeds', r.status === 200, `status ${r.status}`);
check('signup returns the user', r.body?.user?.username === username);

r = await alice('/api/auth/me');
check('me returns the signed-in user', r.body?.user?.username === username);

// Password is hashed, not stored
{
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT password_hash FROM users WHERE username = ?').get(username);
  gdb.close();
  check('password stored as scrypt hash', row.password_hash.startsWith('scrypt$'),
    row.password_hash.slice(0, 30) + '...');
  check('plaintext password absent from the row', !row.password_hash.includes('correct-horse'));
}

const stranger = makeClient();
r = await stranger('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'wrong-password' }),
});
check('wrong password rejected', r.status === 401, `status ${r.status}`);

r = await stranger('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username: username.toUpperCase(), password: 'another-password' }),
});
check('duplicate username rejected (case-insensitive)', r.status === 409, `status ${r.status}`);

r = await stranger('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username: `short_${stamp}`, password: 'abc' }),
});
check('short password rejected', r.status === 400, `status ${r.status}`);

// ===========================================================================
console.log('\n=== 2. Active-time accrual across revisits ===');
r = await alice('/api/game/new', {
  method: 'POST',
  body: JSON.stringify({ targetPopulation: 100000, onlyCoast: false }),
});
check('game created', r.status === 200, `status ${r.status}`);
const timingGame = r.body.gameId;

// Visit round 0 for ~2s, round 1 for ~1s, then back to round 0 for ~2s.
// The clock starts at session creation, so round 0 also holds the gap between
// /api/game/new and this first focus (page load -- legitimately time spent on
// round 0, and on a cold server it includes building the grader index).
// Baseline it out so the assertion measures the deliberate intervals only.
await alice(`/api/game/${timingGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
const startupGap = rawSession(timingGame).rounds[0].elapsedMs;
await sleep(2000);
await alice(`/api/game/${timingGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 1 }) });
await sleep(1000);
await alice(`/api/game/${timingGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
await sleep(2000);
r = await alice(`/api/game/${timingGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });

{
  const s = rawSession(timingGame);
  const r0 = s.rounds[0].elapsedMs;
  const r1 = s.rounds[1].elapsedMs;
  const rest = s.rounds.slice(2).reduce((a, x) => a + x.elapsedMs, 0);
  const r0Deliberate = r0 - startupGap;
  console.log(`      round0=${r0}ms (${r0Deliberate}ms after a ${startupGap}ms startup gap) round1=${r1}ms others=${rest}ms total=${r.body.elapsedMs}ms`);
  check('round 0 accrued BOTH visits (~4s)', r0Deliberate >= 3800 && r0Deliberate <= 4400, `${r0Deliberate}ms`);
  check('round 1 accrued only its own visit (~1s)', r1 >= 800 && r1 <= 1400, `${r1}ms`);
  check('unvisited rounds accrued nothing', rest === 0, `${rest}ms`);
  check('reported total equals the sum', r.body.elapsedMs === r0 + r1 + rest);
}

// summary must refuse before the game is over
r = await alice(`/api/game/${timingGame}/summary`);
check('summary 409s while the game is unfinished', r.status === 409, `status ${r.status}`);

// A solved round must stop accruing even while still on screen.
{
  const { names } = answersFor(timingGame);
  await alice(`/api/game/${timingGame}/guess`, {
    method: 'POST', body: JSON.stringify({ roundIndex: 0, guess: names[0] }),
  });
  const before = rawSession(timingGame).rounds[0].elapsedMs;
  await sleep(1500);
  await alice(`/api/game/${timingGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
  const after = rawSession(timingGame).rounds[0].elapsedMs;
  check('a solved round stops accruing', before === after, `${before}ms -> ${after}ms`);
}

// ===========================================================================
console.log('\n=== 3. Clean run ranks, and the numbers agree ===');
r = await alice('/api/game/new', {
  method: 'POST',
  body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
});
const cleanGame = r.body.gameId;
{
  const { names } = answersFor(cleanGame);
  for (let i = 0; i < names.length; i++) {
    await alice(`/api/game/${cleanGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: i }) });
    r = await alice(`/api/game/${cleanGame}/guess`, {
      method: 'POST', body: JSON.stringify({ roundIndex: i, guess: names[i] }),
    });
    if (!r.body.correct) console.log(`      !! round ${i} "${names[i]}" graded incorrect`);
  }
  check('game reports complete', r.body.complete === true);

  r = await alice(`/api/game/${cleanGame}/summary`);
  check('summary 200 once complete', r.status === 200, `status ${r.status}`);
  const sum = r.body.rounds.reduce((a, x) => a + x.ms, 0);
  check('per-round times sum exactly to the total', sum === r.body.totalMs,
    `${sum} vs ${r.body.totalMs}`);
  check('all 10 rounds in the breakdown', r.body.rounds.length === 10);
  check('breakdown carries city names', r.body.rounds.every((x) => x.name && x.name !== 'Unknown'));
  check('clean run is eligible', r.body.eligible === true, r.body.ineligibleReason ?? '');

  const lb = await alice('/api/leaderboard?population=500000&onlyCoast=0');
  const board = lb.body.boards.find((b) => !b.onlyCoast);
  check('entry appears on the 500k board',
    board.entries.some((e) => e.id === cleanGame && e.username === username));

  const detail = await alice(`/api/result/${cleanGame}`);
  check('result page data loads', detail.status === 200 && detail.body.rounds.length === 10);
}

// ===========================================================================
console.log('\n=== 4. Ineligible runs ===');
// (a) a reveal disqualifies
r = await alice('/api/game/new', {
  method: 'POST', body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
});
const revealGame = r.body.gameId;
{
  const { names } = answersFor(revealGame);
  await alice(`/api/game/${revealGame}/reveal`, { method: 'POST', body: JSON.stringify({ roundIndex: 0 }) });
  for (let i = 1; i < names.length; i++) {
    await alice(`/api/game/${revealGame}/guess`, {
      method: 'POST', body: JSON.stringify({ roundIndex: i, guess: names[i] }),
    });
  }
  r = await alice(`/api/game/${revealGame}/summary`);
  check('revealed game still produces a report', r.status === 200);
  check('revealed game is not eligible', r.body.eligible === false);
  check('reason names the reveal', /reveal/i.test(r.body.ineligibleReason ?? ''), r.body.ineligibleReason);

  const lb = await alice('/api/leaderboard?population=500000&onlyCoast=0');
  const board = lb.body.boards.find((b) => !b.onlyCoast);
  check('revealed game absent from the board', !board.entries.some((e) => e.id === revealGame));
}

// (b) a guest game is never recorded
const guest = makeClient();
r = await guest('/api/game/new', {
  method: 'POST', body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
});
const guestGame = r.body.gameId;
{
  const { names } = answersFor(guestGame);
  for (let i = 0; i < names.length; i++) {
    await guest(`/api/game/${guestGame}/guess`, {
      method: 'POST', body: JSON.stringify({ roundIndex: i, guess: names[i] }),
    });
  }
  r = await guest(`/api/game/${guestGame}/summary`);
  check('guest game still produces a report', r.status === 200);
  check('guest game is not eligible', r.body.eligible === false);
  check('reason names being signed out', /signed in/i.test(r.body.ineligibleReason ?? ''), r.body.ineligibleReason);

  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT COUNT(*) AS n FROM game_results WHERE id = ?').get(guestGame);
  gdb.close();
  check('nothing written to game_results for a guest', row.n === 0);
}

// (c) a shared (cloned) set never ranks
r = await alice(`/api/game/${cleanGame}/clone`, { method: 'POST' });
const clonedGame = r.body.gameId;
{
  const { names } = answersFor(clonedGame);
  for (let i = 0; i < names.length; i++) {
    await alice(`/api/game/${clonedGame}/focus`, { method: 'POST', body: JSON.stringify({ roundIndex: i }) });
    await alice(`/api/game/${clonedGame}/guess`, {
      method: 'POST', body: JSON.stringify({ roundIndex: i, guess: names[i] }),
    });
  }
  r = await alice(`/api/game/${clonedGame}/summary`);
  check('cloned game produces a report', r.status === 200);
  check('cloned game is not eligible', r.body.eligible === false);
  check('reason names the shared set', /shared/i.test(r.body.ineligibleReason ?? ''), r.body.ineligibleReason);
  check('clone was claimed by the player who solved it',
    rawSession(clonedGame).userId !== null);
}

// ===========================================================================
console.log('\n=== 5. Profile ===');
r = await alice('/api/profile');
check('profile loads', r.status === 200, `status ${r.status}`);
check('counts the finished games', r.body.stats.games >= 3, `games=${r.body.stats.games}`);
check('counts exactly one ranked run', r.body.stats.eligible === 1, `eligible=${r.body.stats.eligible}`);
check('recent list is populated', r.body.recent.length >= 3, `${r.body.recent.length} entries`);

r = await guest('/api/profile');
check('profile refuses a signed-out request', r.status === 401, `status ${r.status}`);

// ===========================================================================
console.log('\n=== 6. Prune safety ===');
{
  // The leaderboard entry must survive its game session being pruned.
  const gdb = new DatabaseSync(GAME_DB);
  gdb.prepare('DELETE FROM games WHERE id = ?').run(cleanGame);
  gdb.close();

  const detail = await alice(`/api/result/${cleanGame}`);
  check('result page survives the session being pruned',
    detail.status === 200 && detail.body.rounds.length === 10, `status ${detail.status}`);

  const lb = await alice('/api/leaderboard?population=500000&onlyCoast=0');
  const board = lb.body.boards.find((b) => !b.onlyCoast);
  check('leaderboard entry survives the session being pruned',
    board.entries.some((e) => e.id === cleanGame));
}

finish();
