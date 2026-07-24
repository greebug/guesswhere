/**
 * The path Guesswhere is mounted at under bingbongblitz.com.
 *
 * `basePath` in next.config.ts already handles <Link>, router.push(), and every
 * /_next/* asset URL. What it deliberately does NOT touch is a string you pass
 * to fetch() -- Next has no way to know that '/api/game/x' is meant to be an
 * app-relative URL rather than a deliberate absolute one. So every client-side
 * fetch of an internal route goes through `api()` here.
 *
 * Keep this in sync with `basePath` in next.config.ts; they are the same value
 * and there is no runtime API in the App Router that exposes it to the client.
 */
export const BASE_PATH = '/guesswhere';

/** Prefix an app-internal path (e.g. '/api/game/123') with the base path. */
export function api(path: string): string {
  return `${BASE_PATH}${path}`;
}
