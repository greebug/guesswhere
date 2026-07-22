# Guesswhere

Satellite-imagery city-guessing game. **Read [PLAN.md](PLAN.md) first** — it holds the full
architecture, settled decisions, and phase breakdown.

## Status right now — read this before assuming what's done or what's next

**Phases 1 (city DB) and 2 (matching engine): done, tested, stable.** Don't re-derive
these — `etl/cities.sqlite` and `matching/` are the finished, validated artifacts.

**Phase 3 (game client, in `web/`): core solo loop works end-to-end**, verified through
the real running UI — new game, guess/reveal/report, correct-count tracking, an "Only
Coast" filter (`etl/add-coastal-distance.js` computes `dist_to_coast_km` per city
against Natural Earth's coastline data), all of it.

**Hosting: done and live.** `guesswhere-production.up.railway.app` on Railway (a
Dockerfile, not Nixpacks/Railpack — both were tried first and hit real problems, see
git history on `Dockerfile`/commit messages if curious). Tiles serve from Cloudflare R2
via the Protomaps Worker at `tiles.bingbongblitz.com` (`cloudflare/pmtiles-worker/`) —
`web/app/api/tiles/[file]/route.ts` is retired. `web/lib/server/gameDb.ts` persists
game sessions (and duel lobbies) to a SQLite file at `GAME_DB_PATH`, replacing the old
in-memory `Map`.

**Phase 5 (multiplayer): done.** Two modes:
- **Party link** — any solo game URL is already shared-by-link; `PlayClient.tsx` polls
  every ~2s so a friend's progress shows up live. No lobby, no scoring.
- **Duels** — `/duel/new` creates a named lobby (host picks timer length, target
  round-wins, population/coast filters), `/duel/[lobbyId]` handles join → countdown →
  synchronized play → win. Server-authoritative via absolute deadline timestamps +
  tick-on-read (`web/lib/server/duelLogic.ts`), clients poll `GET .../state` every
  ~750ms rather than WebSockets (Railway's persistent process makes WS *possible*, but
  polling needed zero infra changes and is plenty responsive at this game's pace).

**Not yet built:** phase 4 (accounts + persistent leaderboards — duels currently has no
accounts, identity is a `playerId` cached in `localStorage` per lobby).

**Known environment quirk, not a code bug:** the sandboxed browser preview tab used for
testing reports `document.hidden = true`, which throttles the rendering loop both
Mapbox GL JS and MapLibre depend on, and makes synthetic hover/click unreliable. Server
logic is verified computationally instead (direct fetch/curl, DOM inspection, exposing
map instances to `window` temporarily); actual visual rendering needs a real browser.

**Full history and every settled decision, including ones later corrected:**
[PLAN.md](PLAN.md)'s "Phase 3 follow-ups" section. Read it before assuming a past
decision is still current — a couple of things (population-band model, minimap
starting view) were built one way, then explicitly corrected by the user afterward.

## The one thing to never break

The answer key is **extracted from the minimap tiles themselves**. Both the rendered label and
the graded answer come from the same field in the same file.

- If a city has no minimap label, it is not in the answer key.
- Never add cities to the pool from an outside source.
- Tiles and answer key rebuild together, as one versioned artifact.

The entire project exists because the original game got this wrong.

## Other invariants

- **Mapbox via GL JS map loads, never the raster tile API.** ~1 load/game vs ~3,000 tile
  requests — the difference between $0 and four figures a month.
- **Never cache or proxy Mapbox tiles.** ToS violation, and pointless under map-load billing.
- **Main view is pure imagery.** No vector layers, labels, or overlays. Vectors are minimap-only.
- **Grading is server-side.** The answer never reaches the client.
- **Mapbox logo and attribution stay visible.** ToS requirement.

## Environment

- Windows, PowerShell primary. Bash tool available for POSIX scripts.
- `python` is only the Microsoft Store stub — **not installed**. Use Node + DuckDB for ETL.
- Node and git are available. Repo is git-initialized, pushed to
  `github.com/greebug/guesswhere`, deployed via Railway (auto-deploys on push to
  `master`).

### Bulk data lives OUTSIDE OneDrive

This repo sits under `OneDrive\Desktop\Coding\`, so anything written here gets synced.
Tiles, planet extracts, and GHSL downloads go to **`C:\geodata\`** — never inside the repo.
Only the small build artifact (`cities.sqlite`) comes back into the project.
Add `*.pmtiles` and `*.osm.pbf` to `.gitignore` when the repo is initialized.

Note: `web/data/reported-cities.json` is a *different* kind of data — small, curated,
report-round exclusions (see below) — not bulk geodata. Don't gitignore it.

## Layout

- `etl/` — phase 1 pipeline. `node build.js` regenerates `etl/cities.sqlite` (~7 min).
  Bulk inputs live in `C:\geodata\`.
- `matching/` — phase 2 grading engine. `node --test` for unit tests,
  `node validate.js` to measure false-accept/typo rates against the real corpus.
- `worldcities.csv` — SimpleMaps, 50,250 rows. **Cross-check only, not a source of truth**
  (no alias column).
- `tools/imagery-compare.html` — side-by-side Esri/Mapbox fidelity viewer. Uses raw tile
  endpoints, which is the *expensive* billing path; correct for testing, never for production.
- `web/data/reported-cities.json` — Report Round blocklist. City ids only, no PII. Global
  across all games, persisted across restarts. Grows slowly; a flat file is intentional,
  not a placeholder for "add a real DB later."
- `cloudflare/pmtiles-worker/` — the Protomaps serverless Worker (from
  `github.com/protomaps/PMTiles/tree/main/serverless/cloudflare`) that serves minimap
  tiles from R2 in production. `wrangler deploy` from that directory; `wrangler.toml`
  has the R2 binding, custom domain route, and `ALLOWED_ORIGINS`.
- `web/` — phase 3 Next.js app (16.x, App Router, Turbopack). `.env.local` needs
  `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_TILES_URL` (the Worker's TileJSON endpoint),
  `CITIES_DB`, `GAME_DB_PATH` (all already set locally). On Railway these are set as
  service Variables — `NEXT_PUBLIC_*` ones must also be declared `ARG` in the
  `Dockerfile`, or they end up empty in the built client bundle (Railway only exposes
  Variables to `RUN` steps that explicitly ask for them). Launch via the `web` config in
  `.claude/launch.json` (preview tool), not a bare `npm run dev` — it needs the repo-root
  cwd context. After editing `next.config.ts` or anything under `lib/server/`, delete
  `web/.next` before restarting — Turbopack's dev cache goes stale across those changes
  more often than you'd expect.
  - `matching` is wired in as a `file:../matching` npm dependency (see `web/package.json`),
    not a relative import — Turbopack refuses to resolve paths outside its project root
    otherwise (`turbopack.root` in `next.config.ts` points it at the repo root).
  - `node:sqlite` must be a direct ESM `import` in `.ts` files, never reached via a nested
    `require()` inside an external package — Turbopack's CJS interop breaks on that specific
    combination. See `lib/server/grader.ts`'s comment for the working pattern.

## Grading invariants (phase 2)

- **A guess that exactly names another real city is wrong, not a typo.** This is why
  fuzzy tolerance can stay generous: Kanpur/Kannur and Pune/Puno are ONE edit apart, and
  no threshold separates them from real typos. `name-index.js` enforces it globally.
- **Never widen the distance budget to fix a missed typo.** Reach for a better
  normalization variant or the Damerau transposition rule instead.
- Names ≤4 characters require an exact match, deliberately.
- `grade()` returns the canonical spelling only on success — never on a miss.
