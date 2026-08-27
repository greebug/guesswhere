# Verification scripts (phase 4)

End-to-end checks for accounts, round timing, leaderboards, and email tokens. These
exist because **the sandboxed browser preview can't screenshot** (it reports
`document.hidden = true`, which throttles the render loop), so server behaviour is
verified computationally against a real running server instead of by clicking through
the UI.

## Running them

Start the dev server first (`.claude/launch.json` → `web`, or `npm --prefix web run dev`
from the repo root), then from `web/`:

```bash
node scripts/verify-game.mjs     # 44 checks: auth, active-time accrual, leaderboards, prune safety
node scripts/verify-email.mjs    # 24 checks: verify/reset token handling
node --experimental-strip-types scripts/verify-appurl.mjs   # 12 checks: emailed-link origin resolution
node scripts/verify-eliminated.mjs   # 13 checks: country-on-answer, the eliminated-country hint, one-country-per-game
node scripts/verify-replay.mjs   # 27 checks: "Play this set" on a result page
node scripts/verify-sso.mjs      # 24 checks: the domain-wide session cookie other games read
node scripts/verify-timing.mjs   # 32 checks: pause accounting, and that ranking ignores it
node scripts/verify-usage.mjs    # 30 checks: map-load meter, spend ceiling, rate limit, whitelist
node scripts/verify-rematch.mjs  # 33 checks: duel rematch unanimity, presence, host inheritance
node scripts/cleanup-test-users.mjs   # removes the throwaway accounts the above create
```

`cleanup-test-users.mjs` matches on the username prefixes these scripts sign up with —
**add yours to its `prefixes` list** when adding a script, or its accounts and their
`game_results` rows stay behind and show up in the local leaderboard.

One of them needs no server at all — it builds the style object in-process and checks it:

```bash
node --import ./scripts/alias-hook.mjs scripts/verify-minimap-style.mjs   # 18 checks: minimap layer order
```

`alias-hook.mjs` teaches plain `node` the `@/*` → `web/*` path alias from `tsconfig.json`.
Node strips TypeScript types on its own, but resolves specifiers with no knowledge of
tsconfig, so any lib module that imports through the alias needs it.

`VERIFY_BASE_URL` must include the `/guesswhere` base path — every route lives under it
since the domain migration, so the default `http://localhost:3000` alone 404s:

```bash
VERIFY_BASE_URL=http://localhost:3000/guesswhere node scripts/verify-eliminated.mjs
```

`verify-game.mjs`, `verify-email.mjs` and `verify-eliminated.mjs` read `CITIES_DB` and `GAME_DB_PATH` from
`web/.env.local` (same values the app uses). They read the SQLite files **directly** only
to look up answers — the API never exposes them, which is the whole point — and they
create disposable accounts named `alice_*` / `mailer_*` / `t_*`. Run
`cleanup-test-users.mjs` afterwards so the local leaderboard isn't full of fakes.

## The one check worth understanding

`verify-game.mjs` visits round 0 for ~2s, detours to round 1 for ~1s, returns to round 0
for ~2s, and asserts round 0 accrued **both** visits (~4s) while round 1 accrued only its
own (~1s). That is exactly the behaviour the "active time per slide" model buys, and it's
what makes the per-round times sum to the game total.

It baselines out the gap between session creation and the first `focus` call. That gap is
real, legitimately charged to round 0 (the player is looking at it while the page loads),
and on a **cold** server it includes building the ~11k-city grader index plus the first
`VACUUM` — which is why an un-baselined assertion looked like ~800ms of drift the first
time it ran. It isn't drift.

## The other check worth understanding

`verify-eliminated.mjs` plays 40 games at a 50,000 floor and asserts no two rounds share a
country — measured on the ISO code, not the country *string*. Those differ more often than
you'd expect: the corpus carries two spellings for 31 countries (GHSL's "United States of
America" alongside GeoNames' "United States", and so on), and the old string-keyed rule let
~12% of 50k-floor games quietly contain two cities from the same real country. That was
harmless-ish on its own and became load-bearing the moment the minimap started greying out
eliminated countries — a wrong "India is out of play" is worse than no hint at all.

## Backfilling wall-clock times by hand

`game_results.started_at` and `.paused_ms` are NULL for every run finished before they
existed, and the result page renders those as "— / not recorded". Jesse recorded the
real elapsed times for some of those runs separately, so they can be filled in:

```sql
-- started_at is a unix ms timestamp, NOT a duration. Derive it from the
-- finish time and the elapsed span you recorded:
UPDATE game_results
   SET started_at = finished_at - (<elapsed_minutes> * 60000)
 WHERE id = '<result-id>';
```

Leave `paused_ms` NULL unless you genuinely know it — it is not `elapsed - total_ms`
for an old run, because that difference also contains ordinary between-round time that
was never measured separately. A wrong number here is worse than an honest blank.
Neither column affects ranking, so a backfill can never move a record.

## The cost-control one

`verify-usage.mjs` needs the **server** started with small limits, or the ceiling and the
limit are unreachable in a test run:

```bash
GAMES_PER_DAY_LIMIT=5 npm --prefix web run dev
GAMES_PER_DAY_LIMIT=5 node scripts/verify-usage.mjs
```

Both halves need the value: the server enforces it, the script asserts against it.

It resets the meter and the rate events on the way out, but it *does* write to
`usage_counters` while running — don't point it at the production DB.

**Keep `GAMES_PER_DAY_LIMIT` comfortably high in `.env.local` otherwise.** The other
scripts create a lot of games between them, and a low limit makes them fail with a 429
that looks nothing like the thing they were testing. They currently pass under a limit of
5 only because signed-in and guest games are charged to different actors — that is luck,
not design, and it will break as the suites grow.

Section 7 checks the whitelist from the *outside* only — that a stranger can neither read
the roster nor grant themselves an exemption, and that a granted account really does
bypass both the budget and the rate limit. The **admin** half needs the server started
with `USAGE_EXEMPT_USERS` set, which a plain run can't arrange:

```bash
USAGE_EXEMPT_USERS=<your username> npm --prefix web run dev
```

Then `GET /api/usage/users` returns the roster and `POST` it with
`{"username":"...","exempt":true}` to whitelist someone.

## The layer-order one

`verify-minimap-style.mjs` exists for one assertion that matters and cannot be seen
here: **terrain shading must sit under every label**. Hillshade used to be appended
last in the layer array, so turning on Elevation painted relief over all eleven of the
tileset's symbol layers and washed out the town names — worst on the small ones, whose
type is smallest and whose halo has the least to work with. No amount of halo tuning
beats a raster drawn afterwards; the fix is ordering, and this is what holds it in
place. It checks the hand-inserted layers (eliminated tint, urban fabric, island
markers) for the same property, and runs the whole style through maplibre's own
style-spec validator.

## The two newer ones

`verify-replay.mjs` finishes a real game, then **deletes its `games` row** before
replaying from the result. That single check is the reason the endpoint exists at all:
results are permanent, sessions are pruned at 30 days, and the older `/clone` route reads
the session. The script asserts `/clone` 404s at that point and replay still works.

`verify-sso.mjs` reads raw `Set-Cookie` **attributes**, not just behaviour, because the
attribute *is* the mechanism — a session cookie with the wrong `Path` is simply never sent
to Blitz, and the symptom is the vague "it sometimes forgets me" rather than an error. It
also reproduces a pre-consolidation browser (a `gw_session` cookie and nothing else) and
asserts it still authenticates and gets upgraded, since getting that wrong logs everyone
out on deploy.

## What these do NOT cover

- **Sending a real email.** Needs `RESEND_API_KEY` and a live inbox. `verify-email.mjs`
  seeds tokens directly into the DB and exercises the endpoints, which covers the
  security-relevant paths (expiry, single-use, cross-kind rejection, address mismatch,
  session invalidation) — but the Resend wire call itself is only proven in production.
- **Anything visual.** See the `document.hidden` note above.
