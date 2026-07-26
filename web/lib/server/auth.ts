import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import {
  insertUser,
  insertSession,
  readSessionUser,
  readUserById,
  readUserByUsername,
  deleteSession,
  type UserRow,
} from './gameDb';
import { BASE_PATH } from '../basePath';

// Guesswhere's accounts are the identity for every game on bingbongblitz.com,
// so the session cookie is scoped to the whole domain: riding along on the
// other games' requests is now the POINT, not a leak. (It used to be pinned to
// '/guesswhere' precisely so it wouldn't -- that reasoning is superseded.)
// `cookies().set` does not apply next.config's basePath on its own, so both
// the name and the path here are explicit.
export const SESSION_COOKIE = 'bbb_session';
const SESSION_COOKIE_PATH = '/';

// The pre-consolidation cookie, still honoured on read so nobody who was
// signed in gets kicked out by the deploy. /api/auth/me upgrades a legacy-only
// visitor to the new cookie on their first page view.
//
// Renamed rather than re-pathed on purpose: two cookies both named
// `gw_session` at different paths would BOTH be sent on a /guesswhere request,
// arriving as an unordered pair the server can't tell apart.
export const LEGACY_SESSION_COOKIE = 'gw_session';
const LEGACY_SESSION_COOKIE_PATH = BASE_PATH;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Local cross-game testing runs Guesswhere in production mode (NODE_ENV=production)
// behind `wrangler dev` over plain http, where a Secure cookie is silently
// dropped by the browser and single sign-on looks broken for a reason that has
// nothing to do with the code. Never set this on Railway.
function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_COOKIE !== '1';
}

// scrypt from node:crypto rather than bcrypt/argon2: those are native modules
// that would need a build toolchain in the Dockerfile, and scrypt is a
// memory-hard KDF in its own right. Parameters are the Node defaults' cost
// bumped to the commonly-recommended interactive-login settings.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    emailVerified: row.email_verified === 1,
  };
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
// Deliberately permissive. Strict RFC-5322 validation rejects real addresses
// far more often than it catches typos, and the verification email is the
// actual proof an address works.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters, letters/numbers/underscore/hyphen only';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (password.length > 200) return 'Password is too long';
  return null;
}

export function validateEmail(email: string): string | null {
  if (!EMAIL_RE.test(email) || email.length > 254) return 'That email address looks invalid';
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Issues a session and sets the cookie. Only callable from a Route Handler
 * or Server Function -- `cookies().set` is a no-op during page render. */
export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  const now = Date.now();
  insertSession(hashToken(token), userId, now, now + SESSION_TTL_MS);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: SESSION_COOKIE_PATH,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  for (const [name, path] of [
    [SESSION_COOKIE, SESSION_COOKIE_PATH],
    [LEGACY_SESSION_COOKIE, LEGACY_SESSION_COOKIE_PATH],
  ] as const) {
    const token = store.get(name)?.value;
    if (token) deleteSession(hashToken(token));
    // Each must be deleted at ITS OWN path: browsers match cookies for
    // deletion on name+domain+path, so one delete call can't clear both.
    store.delete({ name, path });
  }
}

/** The current signed-in user, or null. Safe to call from route handlers and
 * server components alike (it only reads). */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token =
    store.get(SESSION_COOKIE)?.value ?? store.get(LEGACY_SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionUser(hashToken(token), Date.now());
}

/**
 * Moves a still-valid pre-consolidation session onto the domain-wide cookie,
 * so an already-signed-in player is recognised by the other games without
 * having to sign in again. No-op unless the legacy cookie is the only one
 * present.
 *
 * Route-handler only, for the same reason as startSession. The session row
 * itself is reused rather than reissued -- the token is unchanged, only where
 * the browser files it.
 */
export async function upgradeLegacySessionCookie(): Promise<void> {
  const store = await cookies();
  if (store.get(SESSION_COOKIE)) return;
  const token = store.get(LEGACY_SESSION_COOKIE)?.value;
  if (!token) return;
  if (!readSessionUser(hashToken(token), Date.now())) return;

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: SESSION_COOKIE_PATH,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  store.delete({ name: LEGACY_SESSION_COOKIE, path: LEGACY_SESSION_COOKIE_PATH });
}

// ---------------------------------------------------------------------------
// Signup / login
// ---------------------------------------------------------------------------

export function createUser(
  username: string,
  password: string,
  email: string | null
): UserRow {
  const row: UserRow = {
    id: randomUUID(),
    username,
    username_lower: username.toLowerCase(),
    password_hash: hashPassword(password),
    email,
    email_verified: 0,
    created_at: Date.now(),
  };
  insertUser(row);
  return row;
}

export function findUserForLogin(username: string): UserRow | null {
  return readUserByUsername(username.trim().toLowerCase());
}

export { readUserById };

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

// In-memory is sufficient: Railway runs this as a single long-lived process,
// so there's no second instance holding a separate counter. If that ever
// changes, this needs to move into SQLite.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;

/** Returns true when the caller is over budget and should be refused. */
export function rateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (attempts.size > 10_000) {
    // Bound the map so a flood of distinct keys can't grow it without limit.
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
  return entry.count > max;
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
