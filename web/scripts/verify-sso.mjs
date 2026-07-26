// Single sign-on: the session cookie that every game on bingbongblitz.com reads.
//
// Guesswhere owns accounts for the whole domain now, so its cookie has to be
// scoped to `/` rather than `/guesswhere` -- and the pre-consolidation
// `gw_session` cookie has to keep working, or the deploy silently signs
// everyone out. Both of those are checked here against the raw Set-Cookie
// headers, because the attribute is the entire mechanism: a cookie with the
// wrong Path is simply never sent to Blitz and the failure looks like
// "sometimes it forgets me".
import { DatabaseSync } from 'node:sqlite';
import { GAME_DB, makeClient, makeChecker } from './env.mjs';

const { check, finish } = makeChecker();

/** Parsed attributes of the named Set-Cookie header, or null. */
function cookieAttrs(setCookies, name) {
  const raw = setCookies.find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  const [pair, ...rest] = raw.split(';').map((s) => s.trim());
  const attrs = { value: pair.slice(name.length + 1), flags: new Set(), raw };
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq === -1) attrs.flags.add(part.toLowerCase());
    else attrs[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
  }
  return attrs;
}

const stamp = Date.now().toString(36);
const username = `alice_${stamp}`;

// ===========================================================================
console.log('\n=== 1. The session cookie is domain-wide ===');
const alice = makeClient();
let r = await alice('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'correct-horse' }),
});
check('signup succeeds', r.status === 200, `status ${r.status}`);

{
  const c = cookieAttrs(r.setCookies, 'bbb_session');
  check('signup sets bbb_session', c !== null);
  check('scoped to the whole domain, not /guesswhere', c?.path === '/', `Path=${c?.path}`);
  check('httpOnly', c?.flags.has('httponly'));
  check('SameSite=Lax', (c?.samesite ?? '').toLowerCase() === 'lax', c?.samesite);
  check('no Domain attribute (host-only)', c?.domain === undefined, c?.domain);
  check('the raw token is not what is stored', (() => {
    const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
    const hit = gdb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(c.value);
    gdb.close();
    return hit.n === 0;
  })());
}

r = await alice('/api/auth/me');
check('me recognises the new cookie', r.body?.user?.username === username);

// ===========================================================================
console.log('\n=== 2. A pre-consolidation session still works ===');
// Reproduce exactly what an already-signed-in player's browser is holding on
// the day this deploys: a gw_session cookie and nothing else.
{
  const login = makeClient();
  r = await login('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'correct-horse' }),
  });
  const token = cookieAttrs(r.setCookies, 'bbb_session').value;

  const legacy = makeClient({ gw_session: token });
  r = await legacy('/api/auth/me');
  check('legacy gw_session is honoured', r.body?.user?.username === username,
    JSON.stringify(r.body?.user ?? null));

  const upgraded = cookieAttrs(r.setCookies, 'bbb_session');
  check('me upgrades it to the domain-wide cookie', upgraded !== null);
  check('upgrade keeps the same session token', upgraded?.value === token);
  check('upgraded cookie is scoped to /', upgraded?.path === '/', `Path=${upgraded?.path}`);

  const cleared = cookieAttrs(r.setCookies, 'gw_session');
  check('and clears the legacy one', cleared !== null && cleared.value === '');
  check('clearing it uses the legacy PATH, or the browser ignores the delete',
    cleared?.path === '/guesswhere', `Path=${cleared?.path}`);

  // The upgraded jar must keep working on its own.
  r = await legacy('/api/auth/me');
  check('still signed in after the upgrade', r.body?.user?.username === username);
}

// ===========================================================================
console.log('\n=== 3. Sign-out clears BOTH cookies ===');
// Browsers match cookies for deletion on name + domain + path. Deleting only
// the new one would leave a live gw_session behind and sign-out would appear
// to do nothing on a returning player's machine.
{
  const login = makeClient();
  r = await login('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'correct-horse' }),
  });
  const token = cookieAttrs(r.setCookies, 'bbb_session').value;

  const both = makeClient({ bbb_session: token, gw_session: token });
  r = await both('/api/auth/logout', { method: 'POST' });
  check('logout succeeds', r.status === 200, `status ${r.status}`);

  const a = cookieAttrs(r.setCookies, 'bbb_session');
  const b = cookieAttrs(r.setCookies, 'gw_session');
  check('bbb_session cleared at /', a !== null && a.value === '' && a.path === '/', `Path=${a?.path}`);
  check('gw_session cleared at /guesswhere',
    b !== null && b.value === '' && b.path === '/guesswhere', `Path=${b?.path}`);

  const gdb = new DatabaseSync(GAME_DB, { readOnly: true });
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  const row = gdb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(hash);
  gdb.close();
  check('the session row is gone from the DB too', row.n === 0);

  r = await both('/api/auth/me');
  check('me reports signed out', r.body?.user === null);
}

// ===========================================================================
console.log('\n=== 4. What another game sees ===');
// Blitz authenticates by forwarding a socket handshake's Cookie header to this
// endpoint. That is the entire contract between the two services, so it is
// worth asserting rather than assuming.
{
  const login = makeClient();
  r = await login('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'correct-horse' }),
  });
  const token = cookieAttrs(r.setCookies, 'bbb_session').value;

  // Exactly what arrives on a handshake: a cookie header, no jar, no session.
  const res = await fetch(`${process.env.VERIFY_BASE_URL ?? 'http://localhost:3000/guesswhere'}/api/auth/me`, {
    headers: { Cookie: `bbb_session=${token}` },
  });
  const body = await res.json();
  check('a raw forwarded Cookie header resolves the user',
    body?.user?.username === username, JSON.stringify(body?.user ?? null));
  check('it returns a stable id to key on', typeof body?.user?.id === 'string' && body.user.id.length > 0);
  check('and never leaks the password hash',
    !JSON.stringify(body).includes('scrypt'), JSON.stringify(body));

  const anon = await fetch(`${process.env.VERIFY_BASE_URL ?? 'http://localhost:3000/guesswhere'}/api/auth/me`);
  check('no cookie means no user (a guest, not an error)',
    anon.status === 200 && (await anon.json()).user === null);
}

finish();
