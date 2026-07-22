# Guesswhere

Satellite-imagery city-guessing game. **Read [PLAN.md](PLAN.md) first** — it holds the full
architecture, settled decisions, and phase breakdown.

## Status right now — read this before assuming what's done or what's next

**Phases 1 (city DB) and 2 (matching engine): done, tested, stable.** Don't re-derive
these — `etl/cities.sqlite` and `matching/` are the finished, validated artifacts.

**Phase 3 (game client, in `web/`): core solo loop works end-to-end**, verified through
the real running UI — new game, guess/reveal/report, correct-count tracking, all of it.
Not yet built: phase 4 (leaderboards), phase 5 (multiplayer).

**Immediate next step, already decided, not yet started:** get the app hosted live
*before* building multiplayer, not after — multiplayer needs real shared/persisted
session state and two actual separate browsers to test against, so a local-only
prototype would just need reworking once hosted. Agreed sequence:
1. Move tile serving onto **Cloudflare R2 + Protomaps' own ready-made Cloudflare Worker**
   (`docs.protomaps.com/deploy/cloudflare`) — documented, purpose-built, do not
   reinvent this. Retires `web/app/api/tiles/[file]/route.ts` entirely.
2. Replace `web/lib/server/gameStore.ts`'s in-memory `Map` with a real persisted store
   (a second small SQLite file is enough). Needed for hosting reliability regardless,
   and it's the same piece multiplayer needs for shared state.
3. Pick an app host — leaning **Railway** (runs a normal persistent Node process, so
   `node:sqlite` and everything else works with zero porting) over Vercel (serverless,
   would need step 2 done first anyway). Not yet confirmed with the user.
4. *Then* build phase 5 against the live target, using the duels-mode spec already
   captured in `PLAN.md` (5-min timer + auto-skip, mutual skip-vote distinct from
   Report Round, "first to N" instead of fixed 10 rounds).

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
- Node and git are available. Repo is not yet git-initialized.

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
- `web/` — phase 3 Next.js app (16.x, App Router, Turbopack). `.env.local` needs
  `NEXT_PUBLIC_MAPBOX_TOKEN` (already set), `TILES_PATH`, `CITIES_DB` (both already set,
  point at `C:\geodata\...` and `etl/cities.sqlite`). Launch via the `web` config in
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
