// Verifies the Mapbox cost controls: the map-load meter, the monthly spend
// ceiling, and the per-player daily game limit.
//
// The point of all three is that the bill is BOUNDED rather than hoped-for,
// so the checks that matter most are the ones proving a refusal actually
// happens -- a counter nobody enforces is just a graph.
//
// Needs the dev server running with a small budget so the ceiling is
// reachable, e.g.:
//   MAPBOX_MONTHLY_LOAD_BUDGET=3 GAMES_PER_DAY_LIMIT=3 npm run dev
// then:
//   node scripts/verify-usage.mjs
import { DatabaseSync } from 'node:sqlite';
import { GAME_DB, makeClient, makeChecker } from './env.mjs';

const { check, finish } = makeChecker();

const db = () => new DatabaseSync(GAME_DB);
const period = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const meter = () => {
  const d = db();
  const row = d
    .prepare('SELECT count FROM usage_counters WHERE metric = ? AND period = ?')
    .get('mapbox_map_loads', period());
  d.close();
  return row?.count ?? 0;
};
const setMeter = (n) => {
  const d = db();
  d.prepare(
    `INSERT INTO usage_counters (metric, period, count) VALUES (?, ?, ?)
     ON CONFLICT(metric, period) DO UPDATE SET count = excluded.count`
  ).run('mapbox_map_loads', period(), n);
  d.close();
};
const clearRates = () => {
  const d = db();
  d.prepare('DELETE FROM rate_events').run();
  d.close();
};

const client = makeClient();
const newGame = () =>
  client('/api/game/new', {
    method: 'POST',
    body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
  });

// ===========================================================================
console.log('\n=== 1. Schema ===');
{
  const d = db();
  const tables = d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('usage_counters','rate_events')")
    .all()
    .map((t) => t.name);
  d.close();
  check('usage_counters exists', tables.includes('usage_counters'));
  check('rate_events exists', tables.includes('rate_events'));
}

// ===========================================================================
console.log('\n=== 2. The meter counts real map loads ===');
setMeter(0);
clearRates();
let r = await newGame();
check('a game can be created', r.status === 200, `status ${r.status}`);
const gameId = r.body.gameId;

check('creating a game alone does NOT move the meter', meter() === 0,
  'only a real map load is billable -- a game nobody opens costs nothing');

r = await client('/api/usage/map-load', { method: 'POST', body: JSON.stringify({ id: gameId, kind: 'game' }) });
check('map-load reports 200', r.status === 200);
check('the meter incremented', meter() === 1, `meter=${meter()}`);

// A refresh is a second billed load against the same game -- it must count.
await client('/api/usage/map-load', { method: 'POST', body: JSON.stringify({ id: gameId, kind: 'game' }) });
check('a second load on the same game counts too', meter() === 2, `meter=${meter()}`);

// ===========================================================================
console.log('\n=== 3. The meter cannot be inflated without limit ===');
{
  const before = meter();
  r = await client('/api/usage/map-load', { method: 'POST', body: JSON.stringify({ id: 'no-such-game', kind: 'game' }) });
  check('unknown id answers 200 (leaks nothing)', r.status === 200);
  check('unknown id does not move the meter', meter() === before, `meter=${meter()}`);

  for (let i = 0; i < 60; i++) {
    await client('/api/usage/map-load', { method: 'POST', body: JSON.stringify({ id: gameId, kind: 'game' }) });
  }
  const after = meter();
  check(
    'one session is capped, so the ceiling cannot be tripped on purpose',
    after - before <= 40,
    `added ${after - before} from 60 forged reports`
  );
}

// ===========================================================================
console.log('\n=== 4. The kill switch actually refuses ===');
{
  const d = db();
  const budgetRow = d.prepare('SELECT count FROM usage_counters WHERE metric = ?').get('mapbox_map_loads');
  d.close();
  void budgetRow;

  setMeter(10_000_000); // unambiguously past any configured budget
  clearRates();
  r = await newGame();
  check('new solo game is refused past budget', r.status === 503, `status ${r.status}`);
  check('refusal says why', r.body?.reason === 'budget', JSON.stringify(r.body?.reason));
  check('refusal explains itself to a player', typeof r.body?.error === 'string' && r.body.error.length > 20);

  r = await client('/api/duel/new', {
    method: 'POST',
    body: JSON.stringify({ name: 'tester', timerSeconds: 60, targetRounds: 3, targetPopulation: 500000, onlyCoast: false }),
  });
  check('duels are refused too -- same map, same cost', r.status === 503, `status ${r.status}`);

  r = await client(`/api/game/${gameId}/clone`, { method: 'POST' });
  check('clone ("Share Cities") is refused too', r.status === 503, `status ${r.status}`);

  // The ceiling must not break games already in progress -- only new ones.
  r = await client(`/api/game/${gameId}`);
  check('an in-flight game still loads while over budget', r.status === 200, `status ${r.status}`);

  setMeter(0);
  r = await newGame();
  check('games resume once the meter is back under budget', r.status === 200, `status ${r.status}`);
}

// ===========================================================================
console.log('\n=== 5. The daily rate limit refuses ===');
{
  setMeter(0);
  clearRates();
  const limitRow = Number(process.env.GAMES_PER_DAY_LIMIT ?? 40);
  let lastStatus = 200;
  let created = 0;
  for (let i = 0; i < limitRow + 3; i++) {
    const res = await newGame();
    lastStatus = res.status;
    if (res.status === 200) created++;
    else break;
  }
  check(
    'the limit stops game creation at the configured number',
    created === limitRow && lastStatus === 429,
    `created ${created} of a ${limitRow} limit, then ${lastStatus}`
  );

  const d = db();
  const n = d.prepare('SELECT COUNT(*) AS n FROM rate_events WHERE kind = ?').get('game').n;
  d.close();
  check('only successful creations were charged to the allowance', n === created, `${n} events for ${created} games`);
}

// ===========================================================================
console.log('\n=== 6. The usage readout is not public ===');
r = await client('/api/usage');
check(
  'anonymous callers get 404, not the numbers',
  r.status === 404,
  'it would tell an attacker exactly how far to push the counter'
);

// ===========================================================================
console.log('\n=== 7. Whitelisting ===');
{
  // Everything here is checked WITHOUT an admin session, because the property
  // that matters is that a non-admin can neither read the roster nor grant
  // themselves an exemption. Exercising the happy path needs the server
  // started with USAGE_EXEMPT_USERS set, which a plain test run can't do.
  r = await client('/api/usage/users');
  check('roster is not readable without admin', r.status === 404, `status ${r.status}`);

  r = await client('/api/usage/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'anyone', exempt: true }),
  });
  check('a stranger cannot grant an exemption', r.status === 404, `status ${r.status}`);

  const d = db();
  const cols = d.prepare('PRAGMA table_info(users)').all();
  const col = cols.find((c) => c.name === 'usage_exempt');
  check('users.usage_exempt column exists', !!col);
  check('it defaults to 0 (nobody is exempt by accident)', col?.dflt_value === '0', String(col?.dflt_value));

  d.close();

  // The bypass has to actually work, or the whitelist is decoration. Sign up a
  // fresh account, flip the flag directly (the endpoint is admin-only by
  // design), push the meter far past any budget, and check that this account
  // gets through while an anonymous one is refused at the same instant.
  const whitelisted = makeClient();
  const name = `timing_vip_${Date.now().toString(36)}`;
  await whitelisted('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username: name, password: 'correct-horse' }),
  });

  setMeter(10_000_000);
  clearRates();

  r = await whitelisted('/api/game/new', {
    method: 'POST',
    body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
  });
  check('a NON-whitelisted account is refused over budget', r.status === 503, `status ${r.status}`);

  const d2 = db();
  const flipped = d2.prepare('UPDATE users SET usage_exempt = 1 WHERE username_lower = ?').run(name.toLowerCase());
  d2.close();
  check('the flag can be set', Number(flipped.changes) === 1);

  r = await whitelisted('/api/game/new', {
    method: 'POST',
    body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
  });
  check('the SAME account now gets through, over budget', r.status === 200, `status ${r.status}`);

  r = await client('/api/game/new', {
    method: 'POST',
    body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
  });
  check('everyone else is still refused', r.status === 503, `status ${r.status}`);

  // And the exemption must cover the rate limit too, not just the budget.
  setMeter(0);
  let ok = 0;
  for (let i = 0; i < Number(process.env.GAMES_PER_DAY_LIMIT ?? 40) + 2; i++) {
    const res = await whitelisted('/api/game/new', {
      method: 'POST',
      body: JSON.stringify({ targetPopulation: 500000, onlyCoast: false }),
    });
    if (res.status === 200) ok++;
    else break;
  }
  check(
    'a whitelisted account is not rate limited either',
    ok === Number(process.env.GAMES_PER_DAY_LIMIT ?? 40) + 2,
    `${ok} games created past the limit`
  );

  const d3 = db();
  d3.prepare('DELETE FROM game_results WHERE user_id IN (SELECT id FROM users WHERE username_lower = ?)').run(name.toLowerCase());
  d3.prepare('DELETE FROM users WHERE username_lower = ?').run(name.toLowerCase());
  d3.close();
}

clearRates();
setMeter(0);
console.log('\n(meter and rate events reset)');
finish();
