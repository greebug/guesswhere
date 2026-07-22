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
node scripts/cleanup-test-users.mjs   # removes the throwaway accounts the above create
```

`verify-game.mjs` and `verify-email.mjs` read `CITIES_DB` and `GAME_DB_PATH` from
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

## What these do NOT cover

- **Sending a real email.** Needs `RESEND_API_KEY` and a live inbox. `verify-email.mjs`
  seeds tokens directly into the DB and exercises the endpoints, which covers the
  security-relevant paths (expiry, single-use, cross-kind rejection, address mismatch,
  session invalidation) — but the Resend wire call itself is only proven in production.
- **Anything visual.** See the `document.hidden` note above.
