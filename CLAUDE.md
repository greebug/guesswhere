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

**Hosting: now served at `bingbongblitz.com/guesswhere`** (see "Domain migration"
below). Still the same Railway service underneath —
`guesswhere-production.up.railway.app` remains the origin, but its root now
redirects into `/guesswhere` and the public address is the custom domain. (a
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

## Domain migration — Guesswhere lives under a base path now (2026-07-24)

All four of Jesse's games moved under one domain: `bingbongblitz.com/blitz`,
`/trio`, `/guesswhere`, `/dabashi`. A **new Cloudflare Worker** at
`../bingbongblitz-hub/` owns `bingbongblitz.com/*`, serves the landing page, and
proxies each prefix to the game that owns it. Read that repo's README before
touching any of this — it holds the routing model and the deploy order.

What this changed inside `web/`, and why each piece matters:

- **`next.config.ts` has `basePath: '/guesswhere'`.** It rewrites `<Link>`,
  `router.push()`, and every `/_next/*` asset URL. It does **NOT** rewrite
  strings passed to `fetch()` — Next can't tell an app-relative path from a
  deliberate absolute one.
- **Therefore every client fetch goes through `api()`** (`lib/basePath.ts`).
  All 28 call sites across 16 files were converted. **A new `fetch('/api/...')`
  written without `api()` will 404 in production and work fine in local dev if
  you happen to hit the origin directly** — that's the trap to watch for.
- **`/rivers.json`** (`lib/minimapStyle.ts`) is a plain public asset, so it
  needed the prefix explicitly too. Same rule as fetch.
- **The `gw_session` cookie is scoped to `/guesswhere`**, not `/` — three other
  games share this origin now. `cookies().delete` must pass the **same path**,
  or sign-out silently fails: browsers match cookies for deletion on
  name+domain+path.
- **`appUrl()` still returns the ORIGIN only** (its 12 tests depend on that);
  `lib/server/email.ts` appends `BASE_PATH`. Set `APP_URL=https://bingbongblitz.com`
  on Railway — **without a path** — or emailed links get the prefix twice.
- **The origin root 307s to `/guesswhere`** via a `basePath: false` redirect, so
  old bookmarks and previously-emailed links still land somewhere.
- **`cloudflare/pmtiles-worker/wrangler.toml`'s `ALLOWED_ORIGINS`** gained
  `https://bingbongblitz.com`. Redeploy that Worker or the minimap gets
  CORS-rejected.

Verified end-to-end locally through the real Worker: game creation, guess
grading, the leaderboard API, `rivers.json`, asset prefixing (no un-prefixed
`/_next/` refs remain), and Blitz's socket.io handshake including the WebSocket
upgrade. **Not yet deployed** — nothing has been pushed.

## The visual system — "orbital telemetry" (2026-07-25)

The UI was plain zinc-on-white-buttons Tailwind; it's now a designed system.
**Read `web/app/globals.css` first — it's the whole thing**, and the components
just assemble its pieces.

- **Palette is meaning-driven, not decorative.** The game already assigned
  meaning to three colors, and the system just extends it everywhere: **teal =
  found/correct/go** (same teal as the map's eliminated tint), **amber =
  revealed/gave up**, **rose = report/destructive**. Everything else stays
  monochrome — that's what stops three saturated accents becoming a fruit salad.
  Backdrop is navy, never neutral black: pure `#000` beside satellite imagery
  reads as a hole in the page.
- **Class vocabulary**: `gw-panel` (glass card) / `gw-panel-lit` (+`--gw-tone`
  for a colored glow) / `gw-btn` + `gw-tone-*` / `gw-cta` / `gw-input` /
  `gw-chip` / `gw-check` / `gw-range` / `gw-eyebrow` / `gw-num` (every live
  number, mono + tabular) / `gw-display` (gradient headline) / `gw-rule`.
- **`components/SpaceBackdrop.tsx`** — fixed backdrop, mounted once in the root
  layout. Drifting color clouds, a graticule, and 140 stars. **Star positions
  come from a seeded PRNG, not `Math.random()`** — random ones would differ
  between the server render and hydration and React would complain. All CSS and
  inline SVG: a decorative background must never add a network request (and
  Mapbox is the only imagery this project fetches, by invariant).
- **`components/OrbitMark.tsx`** — the wireframe-globe logo. Each satellite is a
  *sibling of its ring inside the same rotating group*, so it never moves
  relative to the ring and the ring's rotation does the work. That dodges
  needing SMIL or `offset-path` to send a dot around an ellipse, and it honors
  `prefers-reduced-motion` for free.
- **GameHeader gained a 10-round progress track** — pips colored by settle state
  (teal found / amber revealed / dim open), ringed on the current round, and
  **clickable to jump to that round**. That last part is a behavior addition, not
  just a restyle: it's random-access pagination alongside the answer box's
  existing arrows.
- Duel `PLAYER_COLORS` were retuned to the same palette. They sit on near-black
  glass *and* on satellite imagery, so they need the extra luminance.

**Two traps, both hit for real during this work:**

1. **Custom CSS must live in `@layer components` / `@layer base`.** Tailwind's
   `@import "tailwindcss"` declares the layer order, and **unlayered CSS beats
   every layered rule regardless of specificity** — so an unlayered
   `.gw-btn { color: … }` silently outranks `text-gw-mute` on the same element.
   The header links rendered white and only a computed-style dump explained why.
2. **Never put a default color utility next to a state one** (`text-gw-ink`
   *and* `text-gw-amber` on the same element). Same-layer utilities resolve by
   Tailwind's emit order, not class-attribute order, so that's a coin flip
   rather than a fallback.

**Sandbox note that matters for any future UI verification:** the preview tab
composites no frames (`document.hidden`), which means **CSS transitions never
advance past their start value** — `getComputedStyle` returns pre-transition
values forever and looks exactly like a cascade bug. Inject
`* { transition: none !important }` before reading computed styles. (Also:
Tailwind v4's `scale-*` sets the `scale` property, not `transform`, so reading
`.transform` shows `none` and proves nothing.) Screenshots remain impossible.

## Eliminated-country hints + island markers (2026-07-25)

Three things Jesse asked for after playing, plus one real bug found underneath them:

- **A correct guess now shows "City, Country"**, matching reveal. Typing the country is
  still never required — `grade()` is untouched; only the *displayed* name changed
  (`guess/route.ts` now calls `revealWithCountry`). The point is paging back through ten
  solved rounds and being able to read off which countries are used up.
- **Countries already used are tinted out on the minimap** (solo only). A settled round's
  country can never come up again, so it's dead space. `GET /api/game/[id]/eliminated`
  returns the countries of **settled rounds only** — for an unsettled round that would be
  a straight spoiler, and at the last unsolved round "the one country not yet tinted"
  would name the answer outright. Shapes come one-per-request from
  `GET /api/geo/shape?iso=XX` marked `immutable`, so the browser's own cache dedupes them
  across rounds and games (a batched endpoint would re-download Canada ten times a game).
  The tint fades with zoom but never to zero — "was the last one India or Pakistan?" is a
  question you ask zoomed in. The border labels carry the same colors.
  **Duels deliberately have none of this**: duel rounds are drawn one at a time with no
  country-uniqueness rule, so a used country tells you nothing there.
- **Small isolated islands get a faint marker ring** (`islands.json`, see Layout).
  Unnamed on purpose.

Jesse confirmed the tint live and asked for two follow-ups, both shipped:

- **Tint color now encodes the outcome** — teal-green for a country you found, amber for
  one you revealed, matching the answer box. The green is pulled well toward teal on
  purpose: the basemap's own vegetation is a yellow-leaning green (`#6aab6a`..`#a9cf8d`),
  and a matching green wash over it reads as more forest rather than as a state change.
  `/eliminated` carries an `outcome` field; the client stamps it onto the cached shape at
  draw time (the shape itself is shared across rounds, so it isn't mutated). Jesse then
  asked for it stronger and bluer, so the green went `#00a884` → `#009e9a` and the opacity
  curve up about a third (0.27 → 0.08 across the zoom range).
- **Island markers are bucketed by size, not all drawn at once.** The first version put a
  dot on all ~1,000 islands at every zoom and Jesse (rightly) found it overkill —
  especially at world view, where the islands you actually navigate by were drowned out by
  specks. An island is only worth marking across the band where it's too small to see but
  big enough to be looking for, and that band slides down the zoom range as islands get
  smaller. `ISLAND_BUCKETS` encodes it: at z0 only 50km+ islands are marked (~120
  worldwide, down from 1,000), with smaller ones fading in as you close in and each one's
  marker fading out once its real shape is legible. Markers are also smaller and fainter.
  **`ISLAND_BUCKETS` in `minimapStyle.ts` and `MIN_SPAN_KM` in `tools/build-islands.js`
  have to be read together** — the buckets assume the builder's `span` property.

**The bug: "no two cities from the same country" was not actually holding.** It keyed on
the raw `country` string, and the corpus carries TWO spellings for 31 countries — GHSL's
UN long forms ("United States of America", "Viet Nam", "Russian Federation") against the
GeoNames layer's short ones ("United States", "Vietnam", "Russia"). Measured against the
real corpus: **~12% of 50,000-floor games contained two cities from the same real
country** (7% at 100k, 1.3% at 500k). `lib/server/countryCode.ts` now supplies an
ISO-based `countryKey()` and selection uses it. This had to be fixed for the tint to be
truthful — a wrong "India is out of play" is worse than no hint — but it was a real
pre-existing bug either way. `web/scripts/verify-eliminated.mjs` (11 checks) covers all
of it.

Note `iso2` is missing on 92 of 18,749 playable cities, in 11 country names;
`NULL_ISO_FALLBACK` in `countryCode.ts` maps exactly those. And Natural Earth folds
France's overseas departments into France, so those 17 cities (Réunion, Guadeloupe,
Martinique, Mayotte, French Guiana) go untinted rather than tinting mainland France —
`shapeForIso()` returns null and the client treats a 404 as "nothing to draw".

**Verified computationally, not visually** — the sandbox browser's `document.hidden`
throttle stops MapLibre from ever parsing the style, so the style object is checked
against maplibre's own style-spec validator (layer order, paint expressions) and the API
behaviour by `verify-eliminated.mjs`, but nothing is ever seen rendered. Jesse has
confirmed the original grey tint and the "City, Country" answer live; **the green/amber
colors and the island bucket thresholds have not been looked at by anyone yet.**

## OPEN RIGHT NOW — read this first (as of 2026-07-23)

Everything from the 2026-07-22 post-`76b8607` polish pass (end-of-game report rework,
duel round colors, minimap logo clearance, popup contrast, urban-fabric shading, country
border labels, etc.) shipped, and Jesse subsequently played it live with friends — so
treat that whole pass as **confirmed working**, not just implemented. That live playtest
produced a fresh, larger round of feedback, all shipped across two commits
(`6930a9b`, `3b6ff68`) plus a follow-up framing tweak (`16669b1`):

- Duels: added a Report Round button (mirrors solo's, requires every player to agree),
  round-end summaries now always include the country (not just on timeout), the minimap
  answer-pin shows for every settled round rather than just timeouts, and a real bug was
  found and fixed — a fragile one-shot `setTimeout` driving the round-transition pause
  could leave a duel stuck on the previous round forever if a backgrounded tab throttled
  it. Replaced with a poll-driven wall-clock check (self-healing, matches the rest of the
  duel architecture's tick-on-read philosophy).
- Solo/shared: removed a redundant "ease back toward center on every drag" behavior in
  `MainMap.tsx` (already fully covered by `maxBounds`, and the reported cause of an
  annoying pan snap-back even inside the valid pan radius); replaced hold-Ctrl-to-pin the
  minimap with a click-to-toggle button (holding Ctrl broke typing into the answer box —
  confirmed, not a guess: Ctrl+letter is a reserved browser shortcut in virtually every
  browser); scoped page-scroll lockout to just the two gameplay screens; added a Natural
  Earth rivers overlay (`web/public/rivers.json`) since the stock Protomaps tileset
  genuinely has no river line data below z9 (verified by fetching real tiles) — initially
  cut off right at the z9 handoff, then pulled back to z7 after Jesse reported visible
  overlap with the tileset's own rivers for a few zoom levels (Natural Earth's generalized
  centerlines don't trace the same path as the tileset's OSM-derived ones).
- `MainMap.tsx`'s initial framing widened 10% (`WIDE_WIDTH_KM`/`WIDE_HEIGHT_KM`, which also
  drives the max-zoom-out floor via `applyWideZoomFloor`), pan radius trimmed 10% to offset
  it (`PAN_RADIUS_KM`) — deliberate: see more at a glance, less new ground to find by
  panning past it.
- Investigated (not a bug): whether city-list "randomness" was actually random. Confirmed
  via 3,000-trial simulation against the real algorithm that city selection *within* a
  chosen country is uniformly random (matches theoretical expectation almost exactly for
  several specific cities Jesse named). Country-level representation scaling with
  population/city-count is intentional and Jesse is fine with it.

**New dev tool**: `tools/box-overlay.html` — draggable/resizable zoom+pan rectangles (real
miles, same math as `MainMap.tsx`) over a live Mapbox satellite view, for visually comparing
Guesswhere's framing against the reference game's. See "Layout" below.

**Follow-up pass (2026-07-24): city-overlay.html-driven data quality review.** Jesse
manually reviewed the city database using `tools/city-overlay.html` and reported ~30
issues in three categories — a real name-matching bug, missing small towns, and
metro-area/city-limits granularity (Denver absorbing suburbs, Nile/Kerala-coast towns
merged under one name). Jesse confirmed the third category is fine as-is, out of scope.
The first two were fixed:

- **Sort-comparator bug fixed** (`etl/build.js`'s `resolveAgainstTiles`): candidate
  ranking sorted by raw `mainScore` first, which scores against GHSL's name as ONE
  string even when it's a compound/bracketed form like `"Minneapolis [Saint Paul]"`.
  That let a coincidentally-similar-length wrong neighbor (`"North Saint Paul"`) outrank
  the actual correct answer (`"Minneapolis"`, whose `listScore` — checked, but never
  given tiebreak priority — was already a perfect 1.0). Fixed by sorting on
  `Math.max(mainScore, listScore)` first. Confirmed fixed live against the raw GHSL
  `.gpkg`: Minneapolis (was "North Saint Paul"), Colombo (was "Sri Jayewardenepura
  Kotte"), Oaxaca City (was "Zimatlán de Álvarez"). Quarantine count dropped 422→392 as
  a side effect (30 more cities now clear the name-match threshold).
- **New GeoNames coverage layer** for real towns below GHSL's own Urban Centre threshold
  — confirmed via direct query that GHSL's dataset simply never generates a row for
  these (Missoula, Bozeman, Kalamata, Mâcon, Douliu, etc. — not a filter of ours).
  Sourced from GeoNames `cities500.txt` (already loaded for aliasing), population
  ≥30,000, resolved against the minimap tiles through the same `resolveAgainstTiles`
  path as everything else — same answer-key invariant applies, quarantined the same way
  on a failed match. Critical safeguard against double-counting: a candidate is skipped
  if it falls within another already-accepted city's *physical* radius
  (`sqrt(areaKm2/π)*1.3` — deliberately NOT the generous `radiusForArea` tile-search
  floor, which floors at 25km and would wrongly swallow a real, distinct nearby city
  like Perm into a tiny 7km² satellite village's shadow). Verified: Lakewood, CO (real
  Denver suburb, pop 152k) correctly excluded; Lakewood, CA/WA correctly kept as
  separate. Added a `pop_source` column (`'ghsl'`/`'geonames'`) for transparency;
  `pop_ghsl` stays the one column every downstream consumer (`gameLogic.ts`,
  `matching/grader.js`) filters on, so no other code changes were needed. Result:
  11,422 → 19,765 total rows, 11,030 → 18,749 playable.
- **Surprising find along the way: Perm, Russia (~1M people) had zero GHSL entry at
  all** — not a name-matching miss, GHSL's own Urban Centre Database genuinely never
  generated a polygon for it anywhere nearby (confirmed by scanning the raw `.gpkg`
  across a multi-degree radius). Now covered via the GeoNames layer above (pop 982,419).
- **Memory gotcha for anyone re-running `build.js`:** `TileLabelSource`'s `tileCache`
  (`etl/tile-query.js`) never evicts. The GHSL pass alone already pushes it close to
  Node's default heap ceiling; running the new GeoNames pass immediately after without
  clearing it caused a real OOM crash. `build.js` now calls `tiles.tileCache.clear()`
  between the two passes — if a third pass is ever added, clear it again, or bump
  `--max-old-space-size`.
- **Confirmed NOT bugs — upstream GHSL data, left as-is:** Fort Worth/North Richland
  Hills (GHSL itself split that corridor into two oddly-named chunks with non-compound
  names — no bracket/matching bug present), Luxor, and the Kerala-coast cluster
  (Ponnani/Kochi/Kozhikode — GHSL's own contiguous-built-up clustering genuinely
  absorbed several towns under one name, same category as Denver, which Jesse is fine
  with).
- **New candidates for the Coyah/Conakry-style manual review backlog below** (confirmed
  NOT a matching bug — implausible raw GHSL population values for small-area polygons):
  Sarvestan and Kharameh, Iran (~1M people packed into 16-24km², ~40-60x plausible urban
  density) and Riwoto/Kapoeta, South Sudan. Foz do Iguaçu's crosscheck flag is a false
  positive, not a bug — GHSL's own number (219k) is roughly correct for the real city;
  `worldcities.csv`'s "98" is the bad value there.
- Remember to re-run `etl/add-coastal-distance.js` after any `build.js` rebuild —
  that column isn't part of `build.js`'s own output, and `tools/build-city-overlay.js`
  (and the game's "Only Coast" filter) will error without it.

### OPEN — needs a decision, found while investigating the above

**Real data bug, not an algorithm bug: Conakry (Guinea's capital, ~2M people) is missing
from `etl/cities.sqlite` entirely, and its population landed on a nearby "Coyah" record
instead** (`pop_ghsl: 2,991,111` — Coyah's real population is nowhere near that). This is
why Jesse kept getting Coyah and never Conakry: with Guinea's cities in the corpus, Coyah's
inflated population makes it dominate at higher population-floor games, and Conakry simply
isn't there to be picked at all. Confirmed independently: no city exists within 40km of
Conakry's real coordinates other than this one Coyah point.

The ETL pipeline's own cross-check caught this at build time — Coyah's `crosscheck_note` is
`worldcities.csv "Forécariah" pop=23010 vs GHSL pop=2991111 (130.0x)` — but per
`etl/build.js`'s explicit design (flag only, never auto-exclude, since `worldcities.csv`
itself isn't authoritative and most large flags are false positives — Tokyo, NYC, Singapore,
and Denver all carry 190x-240x flags and are all completely correct), it was never reviewed.

**Also confirmed: the selection algorithm itself is fine.** Jesse proposed picking city #1
from the full pool, eliminating its country, picking city #2 from what's left, etc. — this
is mathematically identical to the current "shuffle once, scan for first-per-country"
approach (a known property of random permutations), so it would not have fixed this. No
code change needed there.

**Next steps, not yet started:**
1. Fix the Coyah/Conakry record specifically — add a correct Conakry entry, correct Coyah's
   population back down to something real. Needs an actual population source for both;
   don't guess.
2. Optionally: spot-check the wider flagged list for other cases that look like *this*
   pattern — a real city missing near a suspiciously inflated small one, or an
   implausible raw population for a small polygon — rather than treating flag size
   alone as a bug signal, since most large flags are legitimate (see above). Candidates
   identified so far, still not corrected: Coyah/Conakry (Guinea), Sarvestan and
   Kharameh (Iran, ~1M crammed into 16-24km²), Riwoto/Kapoeta (South Sudan). All
   confirmed to be genuine upstream GHSL data issues, not matching-pipeline bugs — see
   the 2026-07-24 follow-up pass above for how each was confirmed.

**Open question, still not resolved: Jesse reported Railway showing a "crashed" deploy
despite the site working.** The log excerpt he pasted was a completely clean, successful
Next.js boot (no error, no exception) — nothing in it explains a "crashed" label. No
`railway.json`/health check is configured in the repo. Waiting on him to say what
specifically shows it as crashed (a dashboard badge? a restart count? an email?) and, if
there's an earlier failed attempt in the same deploy's logs, to share that part
specifically.

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
- `tools/box-overlay.html` — standalone dev tool (own Mapbox token prompt, not wired to
  `.env.local`): two draggable/resizable rectangles (zoom = initial framing, pan = how far
  you can wander) over a live satellite view, sized in real miles via the same math as
  `MainMap.tsx`'s `boxAroundCenter`. Lock-together move, per-box aspect-ratio lock
  (Photoshop-crop style), "scale zoom to X% of pan's area," and presets for Guesswhere's
  current numbers vs. the reference game's — built for comparing framing/pan-range changes
  visually before touching `MainMap.tsx`'s constants.
- `tools/city-overlay.html` (generated by `tools/build-city-overlay.js` — re-run that after
  any edit to `cities.sqlite`) — every city as a semi-transparent circle sized by
  `pop_ghsl`, positioned at its real lat/lon, colored by data-quality flag (blue clean,
  yellow/orange/red by crosscheck ratio, bright red quarantined), over a live
  satellite+labels Mapbox view. Built to spot-check the crosscheck-flagged list visually
  (real city missing near a suspiciously inflated small one, like Coyah/Conakry — see the
  open item above) rather than just by ratio size. Filters (flagged/quarantined/min
  ratio/min population) double as a sorted-by-ratio review queue with prev/next
  fly-to-city buttons, plus a name search and one-click "open in Google Maps" links for
  cross-referencing against ground truth. Same shared Mapbox-token localStorage key as
  `box-overlay.html`.
- `tools/build-country-shapes.js` — regenerates `web/data/country-shapes.json` (Natural
  Earth 50m admin-0, stripped to `{iso2, name, geometry}` and simplified). Server-side
  only; feeds both the minimap's border labels and the eliminated-country tint. It
  replaced the old 110m, name-only `country-borders.json`: the corpus's country *strings*
  come from two disagreeing upstream sources, so ISO codes are the only reliable join.
- `tools/build-islands.js` — regenerates `web/public/islands.json`, a marker point per
  small isolated island (source: the Natural Earth 10m coastline already in
  `C:\geodata\coastline\`). Small Pacific islands are a single pixel at world zoom, which
  made finding e.g. Guam a needle-in-a-haystack; these are deliberately unnamed markers,
  since naming islands would start encroaching on the answer key.
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
