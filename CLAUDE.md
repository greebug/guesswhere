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
  (no native module, so nothing extra in the Dockerfile), httpOnly `bbb_session` cookie
  with only `sha256(token)` in the DB. **These are now the accounts for every game on
  bingbongblitz.com** — see "Single sign-on" below. Email is **optional**; a *verified* email is what
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

**Since single sign-on, this repo is no longer deployable on its own.** Guesswhere issues
the session cookie every game on the domain reads, so a change to `lib/server/auth.ts`
affects Blitz too. Deploy **Guesswhere first**, then `dutch-blitz` — order is a preference
rather than a hazard (Blitz-first just means everyone is a guest for a few minutes), but
that direction never has a broken window. The hub Worker needs **no** redeploy: the whole
mechanism rides paths it already routes. See "Single sign-on" below.

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
- **The session cookie used to be scoped to `/guesswhere`** so it wouldn't ride
  along on the other three games' requests. **That is no longer true** — riding
  along is the whole point now (see "Single sign-on" below), and the cookie is
  `bbb_session` at `Path=/`. The deletion rule still bites either way:
  `cookies().delete` must pass the **same path** the cookie was set with, or
  sign-out silently fails — browsers match cookies for deletion on
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
upgrade. **This has since shipped** — `basePath` is on `origin/master` and the
game serves from `bingbongblitz.com/guesswhere`. (This paragraph read "not yet
deployed — nothing has been pushed" for a while after it was no longer true;
check `git log origin/master` before repeating a deploy-status claim from here.)

## Single sign-on: Guesswhere owns accounts for the whole domain (2026-07-26)

One account now covers every game on bingbongblitz.com. Guesswhere is the identity
provider — it already had real accounts (scrypt passwords, optional verified email,
password reset), and Blitz had a 4-digit PIN keyed by typed name in a different database
on a different Railway service. **The PIN sign-on is retired.**

**The mechanism is one cookie and one endpoint. There is no shared secret, no token
format, and no change to the hub Worker** — every game is already same-origin under
bingbongblitz.com, so `/guesswhere/api/auth/*` was reachable from all of them all along.

- **`bbb_session` at `Path=/`** (`lib/server/auth.ts`), so it rides every game's requests.
  Renamed rather than re-pathed **on purpose**: two cookies both named `gw_session` at
  different paths would BOTH be sent on a `/guesswhere` request and arrive as an
  unordered pair the server can't tell apart.
- **`gw_session` is still honoured on read**, and `/api/auth/me` silently upgrades a
  legacy-only visitor to the new cookie (same session token, just refiled). Every page
  mounts `useCurrentUser()`, which calls that route, so nobody signed in got logged out by
  the deploy. `endSession()` deletes **both**, each at its own path.
- **Other games' servers authenticate by forwarding the cookie to
  `GET /guesswhere/api/auth/me`** and taking the answer as authoritative. That contract is
  asserted by `verify-sso.mjs` §4, not assumed. Chosen over an HMAC-signed identity token:
  one source of truth, nothing to rotate, and no window where a revoked session still
  works elsewhere. Guesswhere being unreachable degrades to guest play.
- **`ALLOW_INSECURE_COOKIE=1`** drops the `Secure` flag. Local cross-game testing runs
  Guesswhere in production mode behind `wrangler dev` over plain http, where a `Secure`
  cookie is silently dropped by the browser and SSO looks broken for a reason that has
  nothing to do with the code. **Never set it on Railway.**

Blitz's half lives in `../dutch-blitz` — schema migration, socket.io middleware, and the
leaderboard cutover that keeps its existing records live. See that repo's `NEXT.md`.

## "Play this set" — replaying a result (2026-07-26)

A result page (`/result/[id]`, the detail page behind every leaderboard row) has a **Play
this set** button: the same ten cities in the same order, as an independent playthrough.

`POST /api/result/[resultId]/replay` builds it from **`game_results`, not the `games`
table**, and that is the entire reason it isn't just a call to the existing
`/api/game/[id]/clone`. A result row is a permanent self-contained snapshot; the session
it came from is pruned after 30 days, so `/clone` 404s on any result older than that —
which is most of the leaderboard. `verify-replay.mjs` §4 asserts exactly this by deleting
the session first.

- `isClone: true`, so a replay **never ranks** — the times are printed on the page you
  started from.
- The report blocklist is deliberately **not** applied: a verbatim rerun of one historical
  set, silently swapping a city out would make the two runs incomparable.
- A city that has left the corpus → **410**, not a broken round. The snapshot carries
  lat/lon but not `min_render_zoom`, so the map couldn't frame it anyway.

**Fixed alongside it, same class of bug as the `fetch`/`api()` trap:** "Share Cities" in
both `GameHeader` and `GameReport` built its clipboard URL as
`${window.location.origin}/play/${id}` — `basePath` rewrites `<Link>` and `router.push()`,
but a URL assembled by hand is just a string, so every shared link pointed at
`bingbongblitz.com/play/...` and 404'd. Both now use `BASE_PATH` explicitly.

## The visual system — "night atlas" (2026-07-25)

The UI was plain zinc-on-white-buttons Tailwind; it's now a designed system.
**Read `web/app/globals.css` first — it's the whole thing**, and the components
just assemble its pieces.

**This is the SECOND visual pass.** The first went full sci-fi console (glass
panels, gradient buttons, glows, a starfield, everything in a card) and Jesse's
verdict was that it read as "obviously AI", pointing at
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) — whose whole thesis
is that every model trained on the same SaaS templates emits the same tells.
**The named tells were exactly what pass one had**: glassmorphism, saturated
gradient fills, dark glows, nested cards, and a default font. Do not reintroduce
them; the fix was removal, not tuning.

- **Reference point is a printed atlas under a lamp, not a spacecraft HUD.**
  Warm paper ink (`#f0eade`) on a cold dark ground (`#0e141a`) — a warm-on-cold
  pairing is the single biggest reason it doesn't read as a stock dark theme,
  since cold blue-white on cold dark is what everything ships with.
- **Palette is meaning-driven, not decorative**, and matches the map:
  **verdigris = found/correct/go**, **ochre = revealed/gave up**,
  **vermilion = report/destructive**. Everything else is ink and paper. The
  accents are desaturated printed-ink tones on purpose — these sit beside real
  satellite photography and neon loses to it every time.
- **Three typefaces, three jobs, none of them defaults**: Fraunces (display
  serif, `SOFT`/`WONK` axes on for a little irregularity), Archivo (UI), IBM
  Plex Mono (every live number). Typography is the fastest thing a person reads
  as designed-or-not.
- **Surfaces are flat and opaque.** No `backdrop-filter`, no white-tinted glass,
  no drop shadows (invisible on a dark ground anyway), no glow used for
  hierarchy. Structure comes from borders, rules, and space. **A card must earn
  itself** — related controls sit on the page separated by rules, not nested two
  boxes deep.
- **Class vocabulary**: `gw-panel` / `gw-panel-lit` (+`--gw-tone`) / `gw-btn` +
  `gw-tone-*` / `gw-cta` (solid ink, no gradient) / `gw-input` / `gw-chip` /
  `gw-check` / `gw-range` / `gw-eyebrow` / `gw-num` / `gw-display` / `gw-rule`.
- **`components/Backdrop.tsx`** — a graticule, a little lamplight, and SVG
  fractal-noise paper grain. All CSS and inline SVG: Mapbox is the only imagery
  this project fetches, by invariant. **It replaced a starfield that carried a
  real bug**: stars were drawn in an SVG with `preserveAspectRatio="none"` on
  the assumption a `px` radius resists the viewBox stretch. It doesn't — the
  stretch applies to the whole coordinate system, so 1.5px radii rendered as
  20px grey ovals sitting on top of the text on every screen.
- **`components/GlobeMark.tsx`** — a wireframe globe drawn like an engraving,
  meridians turning behind a fixed outline. Replaced a three-ring orbiting-
  satellite mark: the game is about looking at the ground, not leaving it.
- **GameHeader has a 10-round progress track** — pips by settle state
  (verdigris found / ochre revealed / hollow open), ringed on the current round,
  and **clickable to jump there** (a behavior addition, not just a restyle).
  The ring is a **box-shadow, and the pips don't scale**: the first version used
  `scale-150 ring-2 ring-offset-2`, which pushed the current pip outside the
  header bar and looked clipped against the map behind it.
- Every duel screen has a back link to the menu. Lobby, name prompt, join page
  and creation were all dead ends before.
- Duel `PLAYER_COLORS` follow the same palette; they sit on dark chrome *and* on
  satellite imagery and need the luminance.

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
behaviour by `verify-eliminated.mjs`, but nothing is ever seen rendered. **Jesse has
since confirmed all of it live (2026-07-25)** — the grey tint, the "City, Country"
answer, and the green/amber outcome colors and island bucket thresholds that had gone
unreviewed. Treat the current values as approved rather than provisional.

## Mobile: the gameplay screens (2026-07-25)

Jesse reported Guesswhere "basically unusable on mobile — everything is clipping."
It was, and only on the two gameplay screens: every menu/report screen measured
clean at 375px already. What was actually wrong, all measured in a real viewport:

- **The header ran off the right edge.** Seven controls in one non-wrapping flex
  row reached x=661 in a 375px viewport, so Reveal, Report and Recenter were
  entirely off screen. Both headers (`GameHeader`, `DuelHeader`) wrap now: nav +
  actions on the top row, the wide group (round track / scoreboard) on a full-width
  row of its own. A `w-full` child of a `flex-wrap` parent forces exactly that.
- **The minimap sat on top of the answer bar.** The tight `bottom-16` offset only
  clears the bar when the bar's centered `max-w-2xl` column starts to the right of
  the panel, and that is true at **exactly ≥1280px and nowhere below it** — so this
  was broken on every tablet and small laptop too, not just phones. Hence the
  breakpoint for the tight desktop offsets is **`xl`, not `sm`**. Don't "fix" that
  back to `sm`; it will silently reintroduce a 22px overlap at 768–1279.
- **The answer bar covered the top 5px of the Mapbox logo** at full width. That
  attribution is a ToS requirement, so the bar sits at `bottom-10` below `xl`.
- **`h-screen` → `h-dvh`** on both play screens. `100vh` excludes mobile browser
  chrome, and these screens deliberately can't scroll, so the bottom was unreachable.
- **Expanding the minimap made it smaller on a phone**: `w-[42vw]` is 157px at
  375px wide, narrower than the collapsed `w-72`. Mobile gets `w-[86vw]`.
- The "hover to expand" hint told touch users to do something their device cannot
  do. `matchMedia('(hover: hover)')` picks the wording; Pin (a click) works anywhere.
- Round-track pips were 9px — a fine mouse target, a bad thumb one. The button is
  now a 28px-tall target with the pip drawn inside it. They can't get much wider:
  ten of them plus Elapsed and Recenter have to fit one row, and at a 7px gap the
  row needed 339px of an available 336 on a 360px Android. The gap is 5px on mobile
  purely to win those three pixels.

Verified at 320/360/375/412/768/1024/1280/1600: zero overflowing elements, no
minimap/answer-bar overlap, no answer-bar/logo overlap at any of them. 320px is
deliberately allowed to wrap to a third header row. **Jesse confirmed this live on
2026-07-25** — it was measured but unseen when written; it has now been looked at and
is good.

**Gotcha for the next person measuring this:** an "elements wider than the viewport"
sweep reports ~19 false positives once a round is settled. They're all the minimap's
answer-pin marker, positioned off-view and clipped by its own `overflow-hidden`;
`document.documentElement.scrollWidth` stays correct. Check page scrollWidth, or
skip nodes inside a clipping ancestor.

## Blurry satellite imagery: the half-zoom tile cliff (2026-07-25)

Jesse reported the main map "super blurry at some zoom levels", new since 07-24, and
correctly ruled out the imagery himself — `tools/city-overlay.html` at the same
coordinates looked crisp off the same Mapbox source. He was right that it was us.

**The mechanism, and it is worth internalizing before touching `MainMap.tsx` again:**
`satellite-v9`'s raster source is declared `tileSize: 256` with `roundZoom: true` (read
off the live map object, not assumed — check it again rather than trusting this line).
So the tile level actually drawn is `round(zoom + 1)`, and the stretch applied to each
tile is `2^((zoom + 1) − that level)`. **That is a 2x resolution cliff at every half
zoom.** Measured live at one city:

| map zoom | tile level | drawn at |
|---|---|---|
| 11.49 | 12 | **1.404x** (stretched — blurry) |
| 11.51 | 13 | **0.712x** (supersampled — crisp) |

0.02 of zoom for a 2x swing. And the game opens at *exactly* `minZoom` (`fitBounds` and
`applyWideZoomFloor` are handed the same box), so whichever side of the cliff a round
lands on is what you stare at for the entire round — there is no zooming out of it.

**What pushed it over:** `fffed9b` (07-24 23:02, "Reframe map view/pan box to 16:9").
The old box was 2.35:1 — *wider* than any maximized desktop window, so **width** was the
binding constraint in `cameraForBounds`. The 16:9 box is *narrower* than a maximized
window, so **height** binds instead. That moves the fitted zoom about −0.1, which at some
latitudes is enough to fall off the cliff. At 1920x1080 maximized, latitude ~20°:
z11.551 → tiles at z13, 0.73x **became** z11.451 → tiles at z12, 1.37x. Same imagery,
1.87x fewer real pixels. It is latitude- and window-height-dependent, which is exactly
why it looked like "some cities and some zoom levels" rather than everything.

**The fix (shipped): `transformRequest` upgrades satellite tiles to `@2x`.** A 512px
image for the same 256-unit tile — precisely what GL JS does by itself on a retina
display — so the worst case becomes 0.707x of native and the cliff stops being visible.
Verified in the running app: the transform is installed, `/v4/mapbox.satellite/12/3221/
1771.webp` → `...1771@2x.webp`, style URLs untouched, and that `@2x` URL really does
return 512x512 (fetched both, compared `naturalWidth`).

**Jesse confirmed both fixes live on 2026-07-25** — the imagery reads as sharp again, and
the 25mi framing looks right. That closes the one thing the sandbox could never check
here (nothing in this section was ever *seen* rendered during development; the automation
tab is `document.hidden` and the map area screenshots as solid black). It says nothing
about the pending "night atlas" design review further down — that's a separate question
about the chrome, not the map.

**This does NOT break the billing invariant, and here is the proof rather than the
assertion:** the rewritten URL still carries both `access_token` *and* `sku`. The `sku`
is GL JS's map-load session token — we are rewriting a URL GL JS itself generated for
the `mapbox://` source, not constructing our own endpoint, so it stays on Map Loads and
never touches the Raster Tiles API that `tools/imagery-compare.html` warns about. Same
tile count, ~2-3x the bytes. **If you ever replace this with a self-declared raster
source and explicit `tiles: [...]` URLs, that invariant *does* break.**

**Second, separate bug found while measuring — now also fixed:** the "25 miles wide"
framing spec wasn't what reached the screen. Handing a 25mi x 14.1mi (16:9) box to
`cameraForBounds` fits whichever axis binds, and that box is narrower than any maximized
desktop window, so **height** bound it — a maximized 1920x1080 window showed **~31 miles
across**, wider even than the 29.3mi framing it replaced.

`MainMap.tsx` now computes the zoom from **width alone** (`zoomForWidthKm`) and uses
`jumpTo` rather than `fitBounds`. Mercator's x axis is exactly linear in longitude, with
no latitude term, so width-fitting is exact everywhere — measured live by unprojecting
the real screen edges: **24.972 mi** in a 2560x1220 window (the 0.03 is haversine's R=6371
against `KM_PER_DEG_LAT = 111.32`, a model difference, not an error). Checked across
8 viewports x 5 latitudes: deviation from 25.000 is ~1e-14 mi.

**Do not "simplify" this back to `fitBounds` on a box.** A box fit re-introduces exactly
this bug the moment the container is wider than the box.

**The pan box grows on tall viewports, on purpose.** It's 75mi x 42.2mi, but a 25mi-wide
view is *taller* than 42.2mi on anything past ~1.69:1 portrait (a 390x844 iPhone shows
44.9mi), and Mapbox resolves a viewport that doesn't fit inside `maxBounds` by zooming in
until it does — silently overriding the 25mi width on phones. It was already doing that
before this change. `settle()` now raises the box's height to cover the view when needed
(+2% so rounding can't re-trigger the clamp). The box **width** stays exactly 75.0000mi,
which is the number Jesse measured and confirmed.

**A note on method, because the arithmetic here is easy to get wrong by reimplementing
it:** the `cameraForBounds` model was validated by computing a zoom by hand and checking
it against the real map object (11.156 at lat 23.4 in a 1278x1219 container — exact
match) *before* any conclusion was drawn from it. Do that again rather than trusting a
from-scratch mercator derivation.

## The night-atlas review: closed, approved (2026-07-25)

The redesign (`66801f6`) shipped without anyone having seen it — the sandbox can't
screenshot, so it was built and verified entirely from the DOM. **Jesse has now reviewed
it live and signed it off**, along with the mobile layout and the island/eliminated-tint
colors. His words: flag issues as they come up. So the visual system is the approved
baseline now, not a proposal awaiting feedback — don't "fix" it speculatively.

**The Arial trap does NOT exist here, and this was actually measured rather than
assumed.** On the sister game (BingBongBlitz) the "AI font" complaint turned out to be
literal: browsers don't inherit `font-family` into `button`/`input`/`textarea`/`select`,
so every form control silently rendered in Arial. Guesswhere was never checked for it
until now. Swept with real Chrome (the in-app preview tab is useless for this — it
reports `innerWidth === 0`) across `/`, `/play/[id]`, `/duel/new` and `/duel/join`:
**48 form controls, zero on a non-brand font**, and zero text-bearing elements off
Fraunces/Archivo/IBM Plex Mono.

The one and only hit is `.mapboxgl-ctrl-attrib-button` in Helvetica Neue — Mapbox's own
attribution widget. That is vendor chrome that has to stay visible under the ToS and is
not ours to restyle. **If this sweep is re-run, expect that hit and don't "fix" it.**

```js
// paste in a real browser tab; empty result = clean
const brand = /Fraunces|Archivo|IBM Plex Mono/;
[...document.querySelectorAll('button,input,textarea,select')]
  .filter(e => !brand.test(getComputedStyle(e).fontFamily))
  .map(e => [e.tagName, e.className, getComputedStyle(e).fontFamily]);
```

Why it's clean: controls go through `gw-btn` / `gw-input` / `gw-cta`, which set their own
font. A bare `<button>` or `<input>` added later would silently be Arial, so this sweep is
worth repeating after any batch of new UI.

## OPEN RIGHT NOW — read this first (2026-07-23, plus a 2026-07-26 subsection at the end)

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

**Verification scripts live in `web/scripts/`** — 144 checks across accounts, active-time
accrual, leaderboards, prune safety, email tokens, emailed-link origins, the shared
session cookie, and result replay. See `web/scripts/README.md`. Run these before believing
any change to those areas is safe; the sandbox can't click through the UI, so this is how
server behaviour gets proven.

### OPEN — carried over from the single-sign-on work (2026-07-26)

Everything in "Single sign-on" and "Play this set" below is built and verified as far as
this machine allows, but **two things need Jesse, and one of them is a deploy blocker**:

1. **`GUESSWHERE_ORIGIN=https://bingbongblitz.com` has to be set on the `dutch-blitz`
   Railway service.** It defaults to that value, so it's belt-and-braces rather than
   strictly required — but set it explicitly, because the default is the one thing
   silently holding cross-game sign-in together.
2. **Blitz's Postgres migration was never actually run.** The `ALTER TABLE`s in
   `../dutch-blitz/server/index.ts`'s `initDb()` are unverified: there is no Postgres,
   Docker or `psql` on this machine. **The failure mode is nasty** — without a
   `DATABASE_URL` that server disables accounts entirely and everything degrades to guest,
   which looks exactly like a passing test. Check the first deploy's boot logs (it prints
   `Dropped UNIQUE constraint … on accounts.name_lower`), or run the four statements by
   hand first. All are additive or constraint drops, so re-running them is safe.

Also worth knowing: nothing here has been *seen* by Jesse yet — the "Play this set" button
was driven through the real DOM (click → 200 → correct new game) and measured at 320/375px,
but the sandbox still can't screenshot. Blitz's rebuilt sign-in modal has not been looked
at in a browser at all.

## The name is "Guesswhere v2" (2026-08-01)

Homage, not a version number. Jesse built this after the original **GuessWhere**
(guesswhere.vercel.app, note the capital W — ours is a lowercase w) whose idea the game
comes from; several elements of that one were broken, which is why this exists. The home
page credits it in the footer, and the wording is deliberately credit rather than
comparison — Jesse's private framing was blunter, but published text about someone else's
work shouldn't be.

- **The URL path stays `/guesswhere`.** It's load-bearing for the `bbb_session` cookie
  every game on the domain reads, every emailed verify/reset link, and the hub Worker's
  routing. Renaming it buys nothing and breaks all three.
- Renamed: tab title, hero, every back-link, and the account emails (`From` name and all
  subjects). The hub's tile said **"GuessWhere"** — the *original's* spelling on Jesse's
  own landing page — and is now "Guesswhere v2". That lives in `../bingbongblitz-hub`
  and needs its own `wrangler deploy`.
- **The hero's "2" is sized to the x-height of the display serif's final "e"**:
  `0.673em`, from IBM Plex Mono's 0.72em digits over Fraunces' 0.486em x-height,
  measured off the real fonts with canvas `TextMetrics`. Don't round it, and re-measure
  if either family changes. The "v" stays small so it reads as a version mark.
- At 320px the mark wraps under the word — "Guesswhere" alone is 288px there. Accepted,
  not a bug; it was already true before the mark existed.

**Method note that cost a wrong answer here:** canvas `measureText` silently falls back
to Georgia/monospace if the webfonts haven't finished loading, and reports confident
numbers that are simply wrong. `await document.fonts.ready` first, and check
`document.fonts.check(...)` if a measurement looks off.

## Timing: the clock can be paused, and that is now recorded (2026-07-30)

Jesse worked out that the timer can be stopped deliberately and asked for ideas that
wouldn't invalidate existing records. His reading was right, with one correction and one
addition:

- **Correction:** parked on a solved round, the main map shows *that* round's imagery, so
  you can't study a later round's satellite view for free. What you *can* do for free is
  everything else — **scanning the minimap**, looking things up, asking someone — which is
  most of the work. He confirmed that's what he meant.
- **Addition he hadn't spotted:** `MAX_ACCRUAL_STEP_MS` (30s) caps a single accrual step,
  so **closing the tab for an hour costs 30 seconds**, and this needs no solved round —
  it works on round 1. Backgrounding is a half-rate version. That cap exists so a closed
  tab can't charge a round for hours; under-charging a deliberate pause is its other edge.
- The selection/accrual model is otherwise exactly as documented: one round accrues at a
  time, only while on screen AND unsettled, so the ten sum to the total.

**What shipped: record it, don't rank it.** `total_ms` is still the only thing the
leaderboard orders by, and **no existing record moved**.

- `session.pausedMs` — one addition in `accrue()`, banking `gap - step`. That single
  expression captures *both* leak paths (parked-on-settled, and over-cap gaps), and makes
  `active + paused` equal true wall clock. Optional on the interface because sessions
  persist as a JSON blob and in-flight games have no such field.
- `game_results.started_at` / `.paused_ms` — **nullable, no default, migrated by
  `ALTER TABLE`**. NULL means "not recorded" and renders as an em dash; coercing to 0
  would claim old runs had zero pause, which is a different and false statement. Carried
  on the snapshot rather than read from `games`, which is pruned at 30 days.
- Result page shows **Active (ranked) / Elapsed / Paused**. Header's readout relabels
  itself **"Paused"** on a settled round — the number was already frozen there (client
  and server use the same condition), so this only names what was already happening.
  Silence was the actual hazard: it read as a bug, or as a quiet edge for whoever noticed.
- **Deliberately NOT done: ranking on wall clock.** It punishes an honest bathroom break
  exactly as hard as an exploit, and would retroactively devalue every existing record.
  The option held in reserve is a **per-game pause budget** (a generous allowance, then
  the clock resumes) — it leaves honest runs untouched, so old and new stay comparable.
  Revisit once there's real `paused_ms` data.
- `web/scripts/verify-timing.mjs` (32 checks) pins all of it, including the negative:
  the served board still matches a plain `ORDER BY total_ms`, id for id.

**Backfilling old records:** Jesse has real elapsed times for some historical runs and
will supply them. `scripts/README.md` has the `UPDATE`. Leave `paused_ms` NULL unless
genuinely known — it is *not* `elapsed - total_ms`, since that difference also contains
ordinary between-round time nobody measured.

## Minimap: hillshade goes under the labels (2026-07-30)

Jesse reported elevation shading obscuring town names, "especially the small ones," and
suggested softening the relief under text. **It was layer order, not styling**: the
hillshade layer was appended last, so it painted over all eleven of the tileset's symbol
layers. A raster can't know where type is, and no halo tuning beats a layer drawn
afterwards — so terrain now sits under the labels, anchored to the first `type: 'symbol'`
layer rather than a hardcoded id (survives upstream reordering; `insertBefore` falls back
to appending, i.e. the old behaviour, if no symbol layer exists).

`web/scripts/verify-minimap-style.mjs` (18 checks) holds it, and runs the style through
maplibre's own style-spec validator. It needs `--import ./scripts/alias-hook.mjs`: Node
strips TypeScript types by itself but resolves specifiers with no knowledge of tsconfig's
`@/*` paths.

Also: the Map/Elevation/Pin buttons went from ~19px to **28px tall**, matching the round
track's pips. Growth is mostly *vertical* on purpose — all three share the **collapsed**
panel, which is only **208px wide** on a phone; measured 14px clearance at 320/375px.
Pin was resized to match rather than left small, or it reads as a different class of
control on the same strip.

## The minimap stays open while typing (2026-07-30)

Reading a name off the minimap and typing it into the answer box used to mean: click the
field, move the cursor onto the panel to make it appear, read, move back. `AnswerBox` now
reports focus and `MiniMap`'s `keepOpen` holds the panel open — solo and duels.
`keepOpen` is deliberately separate from `pinned`: Pin is the player's own sticky choice
and losing focus must not silently switch it off.

**Sandbox gotcha, same family as the others:** `input.focus()` here sets `activeElement`
but fires **no focus event**, because the tab itself isn't focused
(`document.hasFocus() === false`). It looks exactly like a dead handler. Dispatch
`focusin`/`focusout` directly — that's what React's `onFocus`/`onBlur` actually listen for.

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
  has the R2 binding, custom domain route, and `ALLOWED_ORIGINS`. **Deployed** —
  Jesse confirmed running the deploy after the `ALLOWED_ORIGINS` change for
  `bingbongblitz.com`. A `wrangler deploy` leaves no trace in git, so this line is
  the only record that the live Worker matches this source.
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
