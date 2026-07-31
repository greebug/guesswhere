// Teaches plain `node` the `@/*` -> `web/*` alias that tsconfig gives the app.
// Needed because some lib modules import each other through the alias, and
// Node's own TypeScript stripping resolves specifiers itself with no knowledge
// of tsconfig paths. Use with: node --import ./scripts/alias-hook.mjs <script>
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    // TypeScript's `paths` mapping is extensionless; Node's resolver is not.
    // Try the real file extensions rather than handing back a bare path.
    const base = join(webRoot, specifier.slice(2));
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`].find(existsSync);
    if (!target) throw new Error(`alias-hook: cannot resolve ${specifier} under ${webRoot}`);
    return { url: pathToFileURL(target).href, shortCircuit: true };
  },
});
