/**
 * Origin used to build the links inside emails (verification, password reset).
 *
 * Lives in its own module with zero imports specifically so it can be unit
 * tested -- lib/server/email.ts pulls in node:sqlite and next/headers
 * transitively, which can't be loaded outside a Next runtime.
 *
 * Resolution order, most explicit first:
 *  1. APP_URL                -- explicit override; what a custom domain needs.
 *  2. RAILWAY_PUBLIC_DOMAIN  -- injected by Railway automatically. Host only,
 *     no scheme, hence the https:// prefix. Means a deploy produces working
 *     links without setting anything, and follows the domain if it changes.
 *  3. http://localhost:3000  -- local dev.
 *
 * Getting this wrong means every emailed link is dead, so it resolves rather
 * than guessing, and never silently falls through to localhost in production
 * (Railway always provides #2).
 */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}
