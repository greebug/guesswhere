// Exercises the verify/reset TOKEN logic without sending mail: tokens are
// seeded straight into the DB, then the real endpoints are called. Covers the
// security-relevant paths (expiry, single-use, wrong kind, address mismatch,
// session invalidation) that no amount of mail-sending would prove anyway.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { GAME_DB, makeClient, makeChecker } from './env.mjs';

const { check, finish } = makeChecker();

const sha = (t) => createHash('sha256').update(t).digest('hex');
const db = () => new DatabaseSync(GAME_DB);

const stamp = Date.now().toString(36);
const username = `mailer_${stamp}`;
const email = `${username}@example.com`;

const c = makeClient();
let r = await c('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'original-password', email }),
});
check('signup with an email succeeds', r.status === 200, `status ${r.status}`);
check('email stored on the account', r.body?.user?.email === email);
check('email starts unverified', r.body?.user?.emailVerified === false);
check('no mail sent without a transport configured', r.body?.verificationSent === false);

const d = db();
const userId = d.prepare('SELECT id FROM users WHERE username = ?').get(username).id;

function seedToken(kind, { email: e = email, ttlMs = 3600_000, used = null } = {}) {
  const token = randomBytes(32).toString('base64url');
  d.prepare(
    `INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sha(token), userId, kind, e, Date.now() + ttlMs, used);
  return token;
}

console.log('\n=== Verification tokens ===');
r = await c(`/api/auth/verify?token=${seedToken('verify', { ttlMs: -1000 })}`);
check('expired verify token rejected', r.status === 400, `status ${r.status}`);

r = await c(`/api/auth/verify?token=${seedToken('verify', { used: Date.now() })}`);
check('already-used verify token rejected', r.status === 400, `status ${r.status}`);

r = await c(`/api/auth/verify?token=${seedToken('verify', { email: 'someone-else@example.com' })}`);
check('token for a different address rejected', r.status === 400, `status ${r.status}`);

r = await c('/api/auth/verify?token=not-a-real-token');
check('garbage token rejected', r.status === 400, `status ${r.status}`);

// A reset token must not be usable as a verify token.
r = await c(`/api/auth/verify?token=${seedToken('reset')}`);
check('reset token rejected by the verify endpoint', r.status === 400, `status ${r.status}`);

const goodVerify = seedToken('verify');
r = await c(`/api/auth/verify?token=${goodVerify}`);
check('valid verify token accepted', r.status === 200, `status ${r.status}`);
check('address marked verified',
  d.prepare('SELECT email_verified FROM users WHERE id = ?').get(userId).email_verified === 1);

r = await c(`/api/auth/verify?token=${goodVerify}`);
check('the same token cannot be replayed', r.status === 400, `status ${r.status}`);

console.log('\n=== Password reset ===');
r = await c('/api/auth/forgot-password', {
  method: 'POST', body: JSON.stringify({ email: 'nobody-here@example.com' }),
});
const unknownBody = JSON.stringify(r.body);
check('unknown address gets a 200', r.status === 200, `status ${r.status}`);

r = await c('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
check('known address gets an identical response (no account enumeration)',
  JSON.stringify(r.body) === unknownBody);

r = await c('/api/auth/reset-password', {
  method: 'POST', body: JSON.stringify({ token: seedToken('reset', { ttlMs: -1000 }), password: 'new-password-x' }),
});
check('expired reset token rejected', r.status === 400, `status ${r.status}`);

r = await c('/api/auth/reset-password', {
  method: 'POST', body: JSON.stringify({ token: seedToken('verify'), password: 'new-password-x' }),
});
check('verify token rejected by the reset endpoint', r.status === 400, `status ${r.status}`);

r = await c('/api/auth/reset-password', {
  method: 'POST', body: JSON.stringify({ token: seedToken('reset'), password: 'short' }),
});
check('short new password rejected', r.status === 400, `status ${r.status}`);

// The real thing. Two live sessions first, to prove both die.
const sessionsBefore = d.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId).n;
const other = makeClient();
await other('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password: 'original-password' }),
});
check('a second device can sign in', (await other('/api/auth/me')).body.user?.username === username);

const goodReset = seedToken('reset');
r = await c('/api/auth/reset-password', {
  method: 'POST', body: JSON.stringify({ token: goodReset, password: 'brand-new-password' }),
});
check('valid reset accepted', r.status === 200, `status ${r.status}`);

check('every session for the user was destroyed',
  d.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId).n === 0,
  `was ${sessionsBefore + 1} before`);
check('the other device is signed out', (await other('/api/auth/me')).body.user === null);

r = await c('/api/auth/reset-password', {
  method: 'POST', body: JSON.stringify({ token: goodReset, password: 'yet-another-password' }),
});
check('reset token cannot be replayed', r.status === 400, `status ${r.status}`);

const fresh = makeClient();
r = await fresh('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password: 'original-password' }),
});
check('old password no longer works', r.status === 401, `status ${r.status}`);
r = await fresh('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password: 'brand-new-password' }),
});
check('new password works', r.status === 200, `status ${r.status}`);

d.close();
finish();
