// Verifies duel rematch: unanimity among players who are still present, the
// lobby keeping its identity across a rematch, and scores resetting.
//
// The check that matters most is the negative one -- a rematch must NOT start
// on one person's say-so -- and the one right after it: a player who closes
// their tab must not be able to block the others forever, which is the failure
// mode a naive "everyone who ever joined" rule would have.
//
// Run the dev server first, then: node scripts/verify-rematch.mjs
import { DatabaseSync } from 'node:sqlite';
import { GAME_DB, makeClient, makeChecker, sleep } from './env.mjs';

const { check, finish } = makeChecker();
const client = makeClient();

const lobbyRow = (id) => {
  const d = new DatabaseSync(GAME_DB, { readOnly: true });
  const row = d.prepare('SELECT data FROM lobbies WHERE id = ?').get(id);
  d.close();
  return row ? JSON.parse(row.data) : null;
};

/** Force a player's lastSeenAt into the past, simulating a closed tab without
 * having to wait out the real 20s presence timeout. */
const ageOutPlayer = (lobbyId, playerId, ms) => {
  const d = new DatabaseSync(GAME_DB);
  const row = d.prepare('SELECT data FROM lobbies WHERE id = ?').get(lobbyId);
  const lobby = JSON.parse(row.data);
  const p = lobby.players.find((x) => x.id === playerId);
  p.lastSeenAt = Date.now() - ms;
  p.joinedAt = Date.now() - ms;
  d.prepare('UPDATE lobbies SET data = ? WHERE id = ?').run(JSON.stringify(lobby), lobbyId);
  d.close();
};

/** Drive a lobby to 'finished' by writing the terminal state directly. Playing
 * a real match through the API would need the answers and a lot of round
 * timing; the rematch rules are what's under test here, not the match loop. */
const forceFinished = (lobbyId) => {
  const d = new DatabaseSync(GAME_DB);
  const row = d.prepare('SELECT data FROM lobbies WHERE id = ?').get(lobbyId);
  const lobby = JSON.parse(row.data);
  lobby.status = 'finished';
  lobby.winnerId = lobby.players[0].id;
  lobby.players[0].roundWins = lobby.settings.targetRounds;
  lobby.rematchBy = [];
  lobby.roundDeadlineAt = null;
  d.prepare('UPDATE lobbies SET data = ? WHERE id = ?').run(JSON.stringify(lobby), lobbyId);
  d.close();
};

async function makeLobbyWithTwo() {
  let r = await client('/api/duel/new', {
    method: 'POST',
    body: JSON.stringify({
      name: 'host', timerSeconds: 60, targetRounds: 2,
      targetPopulation: 500000, onlyCoast: false,
    }),
  });
  if (r.status !== 200) throw new Error(`lobby creation failed: ${r.status}`);
  const { lobbyId, playerId: hostId } = r.body;
  r = await client(`/api/duel/${lobbyId}/join`, {
    method: 'POST',
    body: JSON.stringify({ name: 'guest' }),
  });
  return { lobbyId, hostId, guestId: r.body.playerId };
}

// ===========================================================================
console.log('\n=== 1. A rematch needs everyone, not just one player ===');
const { lobbyId, hostId, guestId } = await makeLobbyWithTwo();
forceFinished(lobbyId);

let r = await client(`/api/duel/${lobbyId}/rematch`, {
  method: 'POST', body: JSON.stringify({ playerId: hostId }),
});
check('host vote accepted', r.status === 200, `status ${r.status}`);
check('but the rematch has NOT started', r.body.started === false);
check('lobby is still finished', lobbyRow(lobbyId).status === 'finished');
check('the vote is recorded', lobbyRow(lobbyId).rematchBy.includes(hostId));

check('the tally is visible to clients', Array.isArray(r.body.state.rematch?.requestedBy));
check('and names who is still needed', r.body.state.rematch.needed.length === 2,
  JSON.stringify(r.body.state.rematch));

// Voting twice must not count twice.
r = await client(`/api/duel/${lobbyId}/rematch`, {
  method: 'POST', body: JSON.stringify({ playerId: hostId }),
});
check('a repeated vote is idempotent', lobbyRow(lobbyId).rematchBy.length === 1,
  JSON.stringify(lobbyRow(lobbyId).rematchBy));
check('still not started', r.body.started === false);

// ===========================================================================
console.log('\n=== 2. The last vote starts it, in the SAME lobby ===');
const before = lobbyRow(lobbyId);
r = await client(`/api/duel/${lobbyId}/rematch`, {
  method: 'POST', body: JSON.stringify({ playerId: guestId }),
});
check('second vote starts the rematch', r.body.started === true, JSON.stringify(r.body).slice(0, 200));

const after = lobbyRow(lobbyId);
check('same lobby id', after.id === before.id);
check('same join code -- nothing to re-share', after.joinCode === before.joinCode);
check('same host', after.hostPlayerId === before.hostPlayerId);
check('same settings', JSON.stringify(after.settings) === JSON.stringify(before.settings));
check('same players', after.players.length === 2);
check('back in the lobby, host controls the start', after.status === 'lobby');
check('scores reset to zero', after.players.every((p) => p.roundWins === 0));
check('winner cleared', after.winnerId === null);
check('rounds cleared', after.rounds.length === 0);
check('votes cleared for next time', (after.rematchBy ?? []).length === 0);
check('roundSeq bumped so clients notice', after.roundSeq > before.roundSeq);
check('matchCount incremented', (after.matchCount ?? 1) === (before.matchCount ?? 1) + 1);

// ===========================================================================
console.log('\n=== 3. A player who left cannot block the rest ===');
{
  const { lobbyId: id2, hostId: h2, guestId: g2 } = await makeLobbyWithTwo();
  forceFinished(id2);
  ageOutPlayer(id2, g2, 60_000); // guest closed their tab a minute ago

  const res = await client(`/api/duel/${id2}/rematch`, {
    method: 'POST', body: JSON.stringify({ playerId: h2 }),
  });
  check('host alone can restart once the other is gone', res.body.started === true,
    JSON.stringify(res.body).slice(0, 200));
  const l = lobbyRow(id2);
  check('the departed player is dropped from the lobby', l.players.length === 1,
    `${l.players.length} players left`);
  check('the remaining player is the host', l.hostPlayerId === l.players[0].id);
}

// ===========================================================================
console.log('\n=== 4. Host inheritance when the HOST is the one who left ===');
{
  const { lobbyId: id3, hostId: h3, guestId: g3 } = await makeLobbyWithTwo();
  forceFinished(id3);
  ageOutPlayer(id3, h3, 60_000); // the original host vanished

  const res = await client(`/api/duel/${id3}/rematch`, {
    method: 'POST', body: JSON.stringify({ playerId: g3 }),
  });
  check('the remaining player can restart', res.body.started === true);
  const l = lobbyRow(id3);
  check('host is inherited, not left dangling', l.hostPlayerId === g3,
    `host=${l.hostPlayerId} guest=${g3}`);
  check('lobby is startable (host matches a real player)',
    l.players.some((p) => p.id === l.hostPlayerId));
}

// ===========================================================================
console.log('\n=== 5. Guards ===');
{
  const { lobbyId: id4, hostId: h4 } = await makeLobbyWithTwo();
  // Still in the pre-match lobby, not finished.
  let res = await client(`/api/duel/${id4}/rematch`, {
    method: 'POST', body: JSON.stringify({ playerId: h4 }),
  });
  check('cannot rematch a match that has not finished', res.status === 400, `status ${res.status}`);

  forceFinished(id4);
  res = await client(`/api/duel/${id4}/rematch`, {
    method: 'POST', body: JSON.stringify({ playerId: 'not-a-player' }),
  });
  check('a stranger cannot vote', res.status === 400, `status ${res.status}`);
  check('and their vote is not recorded', !(lobbyRow(id4).rematchBy ?? []).includes('not-a-player'));

  res = await client(`/api/duel/${id4}/rematch`, { method: 'POST', body: JSON.stringify({}) });
  check('playerId is required', res.status === 400, `status ${res.status}`);

  res = await client('/api/duel/no-such-lobby/rematch', {
    method: 'POST', body: JSON.stringify({ playerId: h4 }),
  });
  check('unknown lobby 404s', res.status === 404, `status ${res.status}`);
}

// ===========================================================================
console.log('\n=== 6. The state poll doubles as the presence heartbeat ===');
{
  const { lobbyId: id5, hostId: h5 } = await makeLobbyWithTwo();
  ageOutPlayer(id5, h5, 60_000);
  check('player starts stale', Date.now() - lobbyRow(id5).players.find((p) => p.id === h5).lastSeenAt > 30_000);

  await client(`/api/duel/${id5}/state?playerId=${h5}`);
  await sleep(50);
  const seen = lobbyRow(id5).players.find((p) => p.id === h5).lastSeenAt;
  check('polling with playerId refreshes presence', Date.now() - seen < 5_000, `${Date.now() - seen}ms ago`);
}

finish();
