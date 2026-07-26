// "Play this set" -- the replay button on a result page.
//
// The point of the endpoint is that it is sourced from `game_results` and NOT
// from the `games` table, because a game session is pruned after 30 days while
// a result row lives forever. So the load-bearing check here is the one that
// deletes the session first and replays anyway.
import { DatabaseSync } from 'node:sqlite';
import { GAME_DB, CITIES_DB, makeClient, makeChecker } from './env.mjs';

const { check, finish } = makeChecker();

function answersFor(gameId) {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT data FROM games WHERE id = ?').get(gameId);
  gdb.close();
  const session = JSON.parse(row.data);
  const cdb = new DatabaseSync(CITIES_DB, { readOnly: true });
  const names = session.rounds.map(
    (r) => cdb.prepare('SELECT canonical_name FROM cities WHERE id = ?').get(r.cityId).canonical_name
  );
  cdb.close();
  return { session, names };
}

function rawSession(gameId) {
  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = gdb.prepare('SELECT data FROM games WHERE id = ?').get(gameId);
  gdb.close();
  return row ? JSON.parse(row.data) : null;
}

const stamp = Date.now().toString(36);
const alice = makeClient();
const username = `alice_${stamp}`;

// ===========================================================================
console.log('\n=== 1. A finished game to replay ===');
let r = await alice('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'correct-horse' }),
});
check('signup succeeds', r.status === 200, `status ${r.status}`);

r = await alice('/api/game/new', {
  method: 'POST',
  body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
});
const sourceGame = r.body.gameId;
check('source game created', r.status === 200, `status ${r.status}`);

const { names } = answersFor(sourceGame);
const sourceCityIds = rawSession(sourceGame).rounds.map((x) => x.cityId);
for (let i = 0; i < names.length; i++) {
  await alice(`/api/game/${sourceGame}/focus`, {
    method: 'POST', body: JSON.stringify({ roundIndex: i }),
  });
  r = await alice(`/api/game/${sourceGame}/guess`, {
    method: 'POST', body: JSON.stringify({ roundIndex: i, guess: names[i] }),
  });
}
check('source game finished', r.body.complete === true);

r = await alice(`/api/result/${sourceGame}`);
check('a result row exists for it', r.status === 200, `status ${r.status}`);
check('the result is eligible (so it can reach a leaderboard)', r.body.eligible === true);

// ===========================================================================
console.log('\n=== 2. Replay reproduces the exact set ===');
r = await alice(`/api/result/${sourceGame}/replay`, { method: 'POST' });
check('replay returns a game', r.status === 200 && !!r.body.gameId, `status ${r.status}`);
const replayId = r.body.gameId;

{
  const s = rawSession(replayId);
  check('replay is a different game', replayId !== sourceGame);
  check('same ten cities in the same order',
    JSON.stringify(s.rounds.map((x) => x.cityId)) === JSON.stringify(sourceCityIds));
  check('every round starts unsolved', s.rounds.every((x) => !x.solved && !x.revealed));
  check('clock starts at zero', s.rounds.every((x) => x.elapsedMs === 0));
  check('rounds carry a render zoom (rebuilt from the corpus, not the snapshot)',
    s.rounds.every((x) => typeof x.minRenderZoom === 'number'));
  check('marked as a shared set', s.isClone === true);
  check('unowned at creation', s.userId === null);
  check('inherits the population floor', s.targetPopulation === 500000);
  check('inherits the coast filter', s.onlyCoast === false);
}

// ===========================================================================
console.log('\n=== 3. A replayed set never ranks ===');
{
  const { names: replayNames } = answersFor(replayId);
  for (let i = 0; i < replayNames.length; i++) {
    await alice(`/api/game/${replayId}/focus`, {
      method: 'POST', body: JSON.stringify({ roundIndex: i }),
    });
    await alice(`/api/game/${replayId}/guess`, {
      method: 'POST', body: JSON.stringify({ roundIndex: i, guess: replayNames[i] }),
    });
  }
  r = await alice(`/api/game/${replayId}/summary`);
  check('replayed game produces a report', r.status === 200, `status ${r.status}`);
  check('a flawless replay is still ineligible', r.body.eligible === false);
  check('reason names the shared set', /shared/i.test(r.body.ineligibleReason ?? ''),
    r.body.ineligibleReason);

  const lb = await alice('/api/leaderboard?population=500000&onlyCoast=0');
  const board = lb.body.boards.find((b) => !b.onlyCoast);
  check('replay absent from the board', !board.entries.some((e) => e.id === replayId));
  check('the original is still on the board', board.entries.some((e) => e.id === sourceGame));
}

// ===========================================================================
console.log('\n=== 4. Survives the source session being pruned ===');
// This is the whole reason the endpoint reads game_results instead of calling
// the existing /clone route: after 30 days the `games` row is gone, and every
// leaderboard entry older than that still has to be playable.
{
  const gdb = new DatabaseSync(GAME_DB);
  gdb.prepare('DELETE FROM games WHERE id = ?').run(sourceGame);
  gdb.close();
  check('source session really is gone', rawSession(sourceGame) === null);

  r = await alice(`/api/game/${sourceGame}/clone`, { method: 'POST' });
  check('the old /clone route 404s once pruned (the problem being solved)',
    r.status === 404, `status ${r.status}`);

  r = await alice(`/api/result/${sourceGame}/replay`, { method: 'POST' });
  check('replay still works', r.status === 200, `status ${r.status}`);
  check('and still reproduces the same set',
    JSON.stringify(rawSession(r.body.gameId).rounds.map((x) => x.cityId))
      === JSON.stringify(sourceCityIds));
}

// ===========================================================================
console.log('\n=== 5. Bad input ===');
r = await alice('/api/result/not-a-real-result/replay', { method: 'POST' });
check('unknown result 404s', r.status === 404, `status ${r.status}`);

// A guest can replay -- result pages are public, and so is the button on them.
const guest = makeClient();
r = await guest(`/api/result/${sourceGame}/replay`, { method: 'POST' });
check('a signed-out visitor can replay', r.status === 200, `status ${r.status}`);
check('their replay is unowned', rawSession(r.body.gameId).userId === null);

finish();
