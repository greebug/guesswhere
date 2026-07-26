// Shared config for the verification scripts. Reads web/.env.local rather than
// hardcoding absolute paths, so these work on any checkout.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env.local');

function loadEnv() {
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(`could not read ${envPath} -- these scripts need the same env the app uses`);
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv();

export const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
export const GAME_DB = env.GAME_DB_PATH;
export const CITIES_DB = env.CITIES_DB;

if (!GAME_DB) throw new Error('GAME_DB_PATH missing from web/.env.local');
if (!CITIES_DB) throw new Error('CITIES_DB missing from web/.env.local');

/** Session cookie names, newest first. `bbb_session` is the domain-wide one
 * every game on bingbongblitz.com reads; `gw_session` is the pre-consolidation
 * Guesswhere-only cookie, still honoured on read and upgraded by
 * /api/auth/me. Scripts need both so they can exercise that upgrade. */
export const SESSION_COOKIES = ['bbb_session', 'gw_session'];

/** Minimal cookie jar -- the session cookie is httpOnly, so these scripts have
 * to carry it the same way a browser would. Paths are ignored: everything here
 * talks to one origin, and the two cookie names never collide. */
export function makeClient(initialCookies = {}) {
  const jar = new Map(Object.entries(initialCookies));
  return async function req(path, init = {}) {
    const headers = { ...(init.headers ?? {}) };
    const sending = [...jar].filter(([, v]) => v !== '');
    if (sending.length) headers.Cookie = sending.map(([k, v]) => `${k}=${v}`).join('; ');
    if (init.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, { ...init, headers, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      if (SESSION_COOKIES.includes(name)) jar.set(name, pair.slice(eq + 1));
    }
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, body, setCookies, jar };
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeChecker() {
  const state = { failures: 0 };
  return {
    state,
    check(label, cond, detail = '') {
      if (!cond) state.failures++;
      console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` -- ${detail}` : ''}`);
    },
    finish() {
      console.log(
        `\n${state.failures === 0 ? 'ALL CHECKS PASSED' : `${state.failures} CHECK(S) FAILED`}`
      );
      process.exit(state.failures === 0 ? 0 : 1);
    },
  };
}
