# Guesswhere

Satellite-imagery city-guessing game. **Read [PLAN.md](PLAN.md) first** — it holds the full
architecture, settled decisions, and phase breakdown.

## Status right now — read this before assuming what's done or what's next

**Phases 1 (city DB) and 2 (matching engine): done, tested, stable.** Don't re-derive
these — `etl/cities.sqlite` and `matching/` are the finished, validated artifacts.

**Phase 3 (game client, in `web/`): core solo loop works end-to-end**, verified through
the real running UI — new game, guess/reveal/report, correct-count tracking, an "Only
Coast" filter (`etl/add-coastal-distance.js` computes `dist_to_coast_km` per city
against Natural Earth's coastline data). Reveal (and duel round-timeouts) show
"City, Country" (`Grader.revealWithCountry()`) — a correct guess still shows just the
city name, unchanged: the player already knew the country then, only the exact
spelling was in question, and that's a separate code path (`grade()`'s own
canonicalName) that was never touched.

**Hosting: done and live.** `guesswhere-production.up.railway.app` on Railway (a
Dockerfile, not Nixpacks/Railpack — both were tried first and hit real problems, see
git history on `Dockerfile`/commit messages if curious). Tiles serve from Cloudflare R2
via the Protomaps Worker at `tiles.bingbongblitz.com` (`cloudflare/pmtiles-worker/`) —
`web/app/api/tiles/[file]/route.ts` is retired. `web/lib/server/gameDb.ts` persists
game sessions (and duel lobbies) to a SQLite file at `GAME_DB_PATH`, replacing the old
in-memory `Map`.

**Phase 5 (multiplayer): done.** Two modes:
- **"Share Cities"** — NOT a live-shared session (that was tried first as 2s polling
  on the same game URL, then explicitly walked back per user feedback: sharing your
  own URL meant a friend's guesses/reveals affected YOUR game too, which wasn't
  wanted). `GameHeader`'s "Share Cities" button calls `POST /api/game/[gameId]/clone`,
  which copies the current game's exact round set (same cities, same order) into a
  brand-new, fully independent `GameSession` — a friend solves it on their own, with
  zero effect on the original.
- **Duels** — `/duel/new` creates a lobby (host picks timer length, target
  round-wins, population/coast filters); host gets back a **4-character join code**
  (not a link — also walked back from an earlier link-based version per request), and
  gives it out. Friends go to `/duel/join`, enter the code + name, hit "Ready" (that
  button *is* the join action — there's no separate ready/not-ready toggle state,
  nothing else requested implied a waiting-room gate). `/duel/[lobbyId]` still works
  directly too, for the host and for rejoining after a refresh. Countdown → synced
  play → win, server-authoritative via absolute deadline timestamps + tick-on-read
  (`web/lib/server/duelLogic.ts`), clients poll `GET .../state` every ~750ms rather
  than WebSockets (Railway's persistent process makes WS *possible*, but polling
  needed zero infra changes and is plenty responsive at this game's pace).

**Phase 4 (accounts, timing, leaderboards): done.** Both of its old open questions are
settled and built.

- **Accounts** — username + password, `lib/server/auth.ts`. scrypt via `node:crypto`
  (no native module, so nothing extra in the Dockerfile), httpOnly `gw_session` cookie
  with only `sha256(token)` in the DB. Email is **optional**; a *verified* email is what
  unlocks password reset, so a mail problem can never block someone from playing.
  Mail goes out via **Resend's REST API** (`lib/server/email.ts`) — plain `fetch`, no npm
  dependency. Needs `RESEND_API_KEY` and `APP_URL`; without them every email feature hides
  itself rather than throwing, which is why local dev works untouched.
  **The entire provider dependency is the `send()` function** — swapping providers means
  changing an endpoint, an auth header, and a body shape, and nothing else. Cloudflare
  Email Sending was built first and then replaced: it requires the $5/mo Workers Paid
  plan, which isn't worth it for a feature used a few times a year.
- **Timing is "active time per slide"** (`accrue`/`setActiveRound` in `gameLogic.ts`): a
  round accrues only while it is BOTH the displayed slide and unsettled. That's what makes
  the ten round times sum *exactly* to the game total, and it means revisiting a solved
  round is free. `POST /api/game/[id]/focus` is both the pagination signal and a 10s
  heartbeat; `MAX_ACCRUAL_STEP_MS` (30s) caps a single step so a closed or backgrounded
  tab can't charge a round for hours.
- **Leaderboards** — only the four preset tiers have boards (50k/100k/500k/2M × regular
  and coast-only, top 5 each, on the home page). Exact match, never bucketing: population
  is a *minimum*, so a higher tier means bigger, easier cities, and rounding a custom
  137k game into the 100k board would be trivially gameable.
- **Ineligible for ranking**: not signed in, any reveal, any reported round, or a
  **cloned ("Share Cities") set** — a clone is by definition cities someone already
  played, so without that rule you could finish a game, clone it, and speedrun the
  answers you just memorized straight to the top.
- `game_results` rows are **self-contained snapshots**, deliberately not references into
  `games`. That's what lets the prune sweep drop old sessions without taking leaderboard
  entries, result pages, or profile history with them. Verified, not assumed.
- **Prune sweep** (`gameDb.ts`): lobbies >24h, games >30d, expired sessions/tokens, then
  `VACUUM` — deleting rows alone leaves the file at its high-water mark. Runs on first
  connection and daily thereafter via `pruneIfDue()`. **Consequence: "Share Cities" links
  expire after 30 days.**

**Known, deliberately out of scope for now (not forgotten, just not asked for yet):**
no Report Round or Reveal in duels; no reconnection/host-migration if a duel player
loses their `localStorage` mid-match (they'd rejoin as a new player). Duels don't feed
the leaderboard — different game shape; accounts only changed where a duel gets its
*name* from (signed in → account name, and the client-supplied one is ignored server-side,
which closes name-spoofing as a side effect).

**Deploy prerequisites for phase 4 on Railway** — the volume (`guesswhere-volume`, `/data`,
5GB) already holds `GAME_DB_PATH`, so accounts/results persist across deploys with no
change. Email additionally needs, one time:

1. **Add `bingbongblitz.com` as a domain in Resend**, then paste the SPF/DKIM records it
   gives you into Cloudflare DNS (the zone is already there). Propagates in ~5-15 min.
2. **Create a Resend API key** (`re_...`).
3. `RESEND_API_KEY` as a Railway service Variable. Server-side only — **no `ARG` in the
   Dockerfile**, unlike the `NEXT_PUBLIC_*` ones.

`APP_URL` (the origin emailed links are built from, `lib/appUrl.ts`) does **not** need
setting on Railway: it falls back to Railway's own `RAILWAY_PUBLIC_DOMAIN`, so links
follow the domain automatically. Set `APP_URL` explicitly only for a custom domain, since
`RAILWAY_PUBLIC_DOMAIN` is read-only and always the `*.up.railway.app` one. It lives in
its own import-free module purely so it's unit-testable — `lib/server/email.ts` pulls in
`node:sqlite` and `next/headers` transitively and can't be loaded outside Next.

Until these are set, accounts work fine and every email feature hides itself
(`isEmailConfigured()`), which is exactly how local dev runs.

**Do NOT reach for `wrangler email ...` for any of this** — that was the original
Cloudflare-based plan, and the command doesn't exist in the pinned wrangler (4.59.1;
checked, it isn't in `wrangler --help` at all). Cloudflare is no longer the mail path.

**Two real bugs found and fixed after initial ship — worth knowing about if touching
these areas again:**
- **Duels' black screen** (`web/app/duel/[lobbyId]/DuelClient.tsx`): the round-
  transition-detection effect used `displayedRoundSeq === null` as its "nothing shown
  yet" sentinel, but that gets consumed by the very first (lobby-phase) state
  snapshot — and *starting* a match doesn't bump `roundSeq` (only *advancing between*
  rounds does), so the client never noticed the lobby/countdown→playing transition for
  round 0. The map stayed unmounted for the entire first round. Fixed by keying off
  `displayedRound` itself instead. If `roundSeq` logic gets touched again: it only
  increments on advance, never on start.
- **Zoom-out-to-whole-world race** (`web/components/MainMap.tsx`): `minZoom` was only
  ever set inside `settle()`, itself gated behind the map style finishing loading —
  but `cameraForBounds` (which computes the floor) is pure geometry over the
  container's size and never needed a loaded style. That gate left a real window on
  **every** round transition, not just the first, where a fast scroll right as a round
  started could reach whole-world view before the floor applied. Fixed by applying the
  floor immediately and unconditionally, in addition to the settled recompute.
  Verified live via temporary `window.__mainMap` instrumentation (not just reading the
  code) that `minZoom` is already correct at the earliest possible moment the map
  object exists, before `isStyleLoaded()` is even true.
- Both bugs were initially, wrongly, chalked up to "probably just imagery still
  loading" before being properly reproduced and root-caused — worth being suspicious
  of that explanation specifically in this codebase, it's hidden real bugs twice.

**Known environment quirk, not a code bug:** the sandboxed browser preview tab used for
testing reports `document.hidden = true`, which throttles the rendering loop both
Mapbox GL JS and MapLibre depend on, and makes synthetic hover/click unreliable. Server
logic is verified computationally instead (direct fetch/curl, DOM inspection, exposing
map instances to `window` temporarily); actual visual rendering needs a real browser.

**Full history and every settled decision, including ones later corrected:**
[PLAN.md](PLAN.md)'s "Phase 3 follow-ups" section. Read it before assuming a past
decision is still current — a couple of things (population-band model, minimap
starting view) were built one way, then explicitly corrected by the user afterward.

## OPEN RIGHT NOW — read this first (as of 2026-07-22, commit `76b8607`)

Phase 4 is **built, pushed, and live in production**. Deploy verified working against
`guesswhere-production.up.railway.app`: `emailEnabled: true` (so `RESEND_API_KEY` is
reaching the process), all 8 leaderboards return, the schema migration ran cleanly against
the real ~94MB DB, `focus` accrues time correctly (259ms → 3401ms over a 3s gap), and
`summary` correctly 409s on an unfinished game.

**The one thing genuinely unfinished: a real email has never been sent.** Jesse was about
to sign up on the live site with `jesse@vannewkirk.com` and click the verification link.
**Ask how that went before assuming it worked.**

If mail didn't arrive, do NOT retry blindly — `send()` in `lib/server/email.ts` logs
Resend's HTTP status, and that number names the cause: **401** bad API key, **403** sending
domain not verified / DNS still propagating, **422** malformed request. Get the status from
the Railway logs first. Also check spam: first mail from a newly-verified domain often
lands there, which is expected rather than a bug.

**Also never visually confirmed: the minimap's clearance above the Mapbox logo.** Measured
geometrically at 11px with no overlap and the logo visible, but the sandbox browser cannot
screenshot (`document.hidden = true` throttles the render loop). Needs one glance in a real
browser during a round. Same reason attribution text never populates in the sandbox — both
MapLibre's and Mapbox's are empty there, which is environmental, not a regression.

**Verification scripts live in `web/scripts/`** — 80 checks across accounts, active-time
accrual, leaderboards, prune safety, email tokens, and emailed-link origins. See
`web/scripts/README.md`. Run these before believing any change to those areas is safe;
the sandbox can't click through the UI, so this is how server behaviour gets proven.

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
  - **`next dev` does not fail on TypeScript errors — only `npm run build` does a full
    check.** This is how a real bug shipped unnoticed: `@types/node@^20` predates
    `node:sqlite`'s type declarations, `next dev` never complained, and it only surfaced
    when Railway's Docker build ran `next build` for the first time. Always run
    `npm run build` before considering a server-side or type-level change verified —
    `tsc --noEmit` alone is a good fast check but `next build` is the one that matches
    what actually ships.
  - `web/lib/server/duelLogic.ts` + `duelStore.ts` — the Duels data model/persistence
    (see status section above); `web/lib/server/gameDb.ts` holds both the `games` and
    `lobbies` SQLite tables in one file/connection (no reason to open the DB twice).

## Grading invariants (phase 2)

- **A guess that exactly names another real city is wrong, not a typo.** This is why
  fuzzy tolerance can stay generous: Kanpur/Kannur and Pune/Puno are ONE edit apart, and
  no threshold separates them from real typos. `name-index.js` enforces it globally.
- **Never widen the distance budget to fix a missed typo.** Reach for a better
  normalization variant or the Damerau transposition rule instead.
- Names ≤4 characters require an exact match, deliberately.
- `grade()` returns the canonical spelling only on success — never on a miss.
