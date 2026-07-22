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

export const SESSION_COOKIE = 'gw_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(hashToken(token));
  store.delete(SESSION_COOKIE);
}

/** The current signed-in user, or null. Safe to call from route handlers and
 * server components alike (it only reads). */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionUser(hashToken(token), Date.now());
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
