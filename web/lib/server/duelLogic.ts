import { randomUUID } from 'node:crypto';
import type { Grader } from './grader';
import { pickReplacementCity } from './gameLogic';
import { addReportedId, getReportedIds } from './reportedCities';

const COUNTDOWN_MS = 5000;

export interface Player {
  id: string;
  name: string;
  roundWins: number;
  joinedAt: number;
  /** Set when the player was signed in as they joined -- their name then comes
   * from the account rather than a text box, so it can't be spoofed. Null for
   * guests, who still type whatever they like. */
  userId?: string | null;
  /** Last time this player's client polled for state. Presence exists for one
   * reason: a rematch needs everyone to agree, and without it a single closed
   * tab would block the remaining players forever. Optional because lobbies
   * persist as a JSON blob -- for one written before this shipped, joinedAt
   * stands in (see presentPlayers). */
  lastSeenAt?: number;
}

export interface DuelRound {
  cityId: number;
  lat: number;
  lon: number;
  minRenderZoom: number;
  solvedByPlayerId: string | null;
  timedOut: boolean;
  /** Player ids who've hit Report on this round. Plain array, not a Set --
   * the whole lobby is JSON.stringify'd for storage (see duelStore.ts). */
  reportedBy: string[];
}

export interface DuelSettings {
  timerSeconds: number;
  targetRounds: number;
  targetPopulation: number;
  onlyCoast: boolean;
}

export type DuelStatus = 'lobby' | 'countdown' | 'playing' | 'finished';

export interface DuelLobby {
  id: string;
  joinCode: string;
  hostPlayerId: string;
  players: Player[];
  settings: DuelSettings;
  status: DuelStatus;
  countdownEndsAt: number | null;
  roundDeadlineAt: number | null;
  rounds: DuelRound[];
  currentRoundIndex: number;
  // Bumped every round transition -- lets polling clients detect "a round
  // just ended" even if they were mid-poll when it happened, without needing
  // a push mechanism.
  roundSeq: number;
  winnerId: string | null;
  createdAt: number;
  /** Mapbox map loads reported against this lobby -- same meter and same cap
   * as a solo session's. Optional: lobbies persist as a JSON blob, so ones
   * already in flight have no such field. */
  mapLoads?: number;
  /** Player ids who've pressed Rematch on the current end screen. Cleared the
   * moment a rematch starts, and whenever a match ends, so it can never carry
   * a stale agreement into the next one. */
  rematchBy?: string[];
  /** How many matches this lobby has played, starting at 1. Only used to scale
   * the map-load cap: one lobby that rematches five times legitimately costs
   * five matches' worth of loads, and a flat per-lobby cap would silently stop
   * counting them. */
  matchCount?: number;
}

export function newLobbyId(): string {
  return randomUUID();
}

export function newPlayerId(): string {
  return randomUUID();
}

// No 0/O, 1/I/L -- avoids ambiguity when a code is read aloud or typed from
// memory. 31 symbols ^ 4 chars =~ 924k combinations, plenty for a
// friends-only prototype with no code reuse/expiry.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function createLobby(
  hostName: string,
  settings: DuelSettings,
  joinCode: string,
  userId: string | null = null
): DuelLobby {
  const host: Player = {
    id: newPlayerId(),
    name: hostName,
    roundWins: 0,
    joinedAt: Date.now(),
    userId,
    lastSeenAt: Date.now(),
  };
  return {
    id: newLobbyId(),
    joinCode,
    hostPlayerId: host.id,
    players: [host],
    settings,
    status: 'lobby',
    countdownEndsAt: null,
    roundDeadlineAt: null,
    rounds: [],
    currentRoundIndex: 0,
    roundSeq: 0,
    winnerId: null,
    createdAt: Date.now(),
    rematchBy: [],
    matchCount: 1,
  };
}

export function addPlayer(lobby: DuelLobby, name: string, userId: string | null = null): Player {
  const now = Date.now();
  const player: Player = {
    id: newPlayerId(),
    name,
    roundWins: 0,
    joinedAt: now,
    userId,
    lastSeenAt: now,
  };
  lobby.players.push(player);
  return player;
}

// A client polls every ~750ms, so this is roughly 25 missed polls -- long
// enough to ride out a phone locking or a laptop sleeping for a moment, short
// enough that someone who genuinely closed the tab stops blocking a rematch
// while the others are still looking at the end screen.
const PRESENCE_TIMEOUT_MS = 20_000;

// Clients poll ~750ms, but the stamp only needs to be accurate to a few
// seconds against a 20s timeout. Re-stamping on every poll would make the
// lobby row differ every time and force a SQLite write per client per poll,
// defeating the state route's existing "only save if something changed"
// check. This trades presence granularity we don't need for ~4x fewer writes.
const SEEN_RESOLUTION_MS = 3000;

/** Stamped from the state poll, which every client runs continuously. */
export function markSeen(lobby: DuelLobby, playerId: string, now = Date.now()): void {
  const player = lobby.players.find((p) => p.id === playerId);
  if (!player) return;
  if (player.lastSeenAt !== undefined && now - player.lastSeenAt < SEEN_RESOLUTION_MS) return;
  player.lastSeenAt = now;
}

/** Players whose clients are still polling. `joinedAt` is the fallback for a
 * lobby written before lastSeenAt existed -- during the deploy window that
 * makes a long-running player look absent for up to one poll, which is the
 * harmless direction: it can only ever let a rematch start with fewer people,
 * never block one. */
export function presentPlayers(lobby: DuelLobby, now = Date.now()): Player[] {
  return lobby.players.filter((p) => now - (p.lastSeenAt ?? p.joinedAt) < PRESENCE_TIMEOUT_MS);
}

/** Picks one more city, never repeating one already used in this lobby.
 * Unlike solo mode, duels don't enforce cross-round country uniqueness --
 * "first to N correct, timeouts skip and keep going" makes the round count
 * open-ended, and a long match would eventually and artificially run out of
 * distinct countries. */
function pickNextRound(lobby: DuelLobby, grader: Grader): DuelRound {
  const excludeIds = new Set(lobby.rounds.map((r) => r.cityId));
  const city = pickReplacementCity(
    lobby.settings.targetPopulation,
    grader,
    excludeIds,
    new Set(),
    lobby.settings.onlyCoast
  );
  return {
    cityId: city.id,
    lat: city.lat,
    lon: city.lon,
    minRenderZoom: city.min_render_zoom,
    solvedByPlayerId: null,
    timedOut: false,
    reportedBy: [],
  };
}

export function startLobby(lobby: DuelLobby, grader: Grader): void {
  const round = pickNextRound(lobby, grader);
  lobby.rounds = [round];
  lobby.currentRoundIndex = 0;
  lobby.status = 'countdown';
  lobby.countdownEndsAt = Date.now() + COUNTDOWN_MS;
  lobby.roundDeadlineAt = null;
}

function advanceRound(lobby: DuelLobby, winnerPlayerId: string | null, grader: Grader): void {
  const current = lobby.rounds[lobby.currentRoundIndex];

  if (winnerPlayerId) {
    current.solvedByPlayerId = winnerPlayerId;
    const player = lobby.players.find((p) => p.id === winnerPlayerId);
    if (player) player.roundWins++;
    if (player && player.roundWins >= lobby.settings.targetRounds) {
      lobby.status = 'finished';
      lobby.winnerId = winnerPlayerId;
      lobby.roundDeadlineAt = null;
      // Belt and braces: a fresh end screen always starts with nobody having
      // agreed to anything, so no stale vote can carry into this match's
      // rematch tally.
      lobby.rematchBy = [];
      lobby.roundSeq++;
      return;
    }
  } else {
    current.timedOut = true;
  }

  const next = pickNextRound(lobby, grader);
  lobby.rounds.push(next);
  lobby.currentRoundIndex++;
  lobby.roundSeq++;
  lobby.roundDeadlineAt = Date.now() + lobby.settings.timerSeconds * 1000;
}

/**
 * Records one player's vote to run the match again, and starts the rematch
 * once everyone still present has voted.
 *
 * Unanimity is deliberate (it's what was asked for) but it's measured against
 * players who are still *polling*, not everyone who ever joined -- otherwise
 * one person closing their tab would leave the rest permanently unable to
 * rematch, with no way out short of making a new lobby and redistributing the
 * code.
 *
 * A rematch reuses this same lobby rather than creating a new one: same id,
 * same join code, same host, same settings, same people. That's the whole
 * point -- nobody has to re-share anything.
 */
export function requestRematch(
  lobby: DuelLobby,
  playerId: string,
  now = Date.now()
): { ok: boolean; started: boolean; reason?: string } {
  if (lobby.status !== 'finished') return { ok: false, started: false, reason: 'match is not over' };
  if (!lobby.players.some((p) => p.id === playerId)) {
    return { ok: false, started: false, reason: 'not a player in this lobby' };
  }

  const votes = new Set(lobby.rematchBy ?? []);
  votes.add(playerId);
  // The voter is present by definition -- they just made a request.
  markSeen(lobby, playerId, now);

  const present = presentPlayers(lobby, now);
  // Someone who voted and then walked away still counts: they said yes, and
  // dropping their vote would make the tally jitter as people's tabs sleep.
  const everyonePresentAgreed = present.every((p) => votes.has(p.id));

  lobby.rematchBy = [...votes];
  if (!everyonePresentAgreed) return { ok: true, started: false };

  resetForRematch(lobby, present, now);
  return { ok: true, started: true };
}

/** Back to the pre-match lobby, keeping identity and dropping scores.
 *
 * Deliberately returns to 'lobby' rather than jumping straight into a
 * countdown: the host stays in charge of starting, and gets the chance to
 * change the timer or the population floor before going again -- which is
 * usually exactly what people want after a lopsided match. */
function resetForRematch(lobby: DuelLobby, present: Player[], now: number): void {
  const stillHere = new Set(present.map((p) => p.id));
  // Drop players who have gone. Keeping them would leave ghosts on the
  // scoreboard and, worse, make the NEXT rematch impossible to agree on.
  const remaining = lobby.players.filter((p) => stillHere.has(p.id));
  lobby.players = remaining.length > 0 ? remaining : lobby.players;

  for (const p of lobby.players) p.roundWins = 0;

  // If the original host left, the longest-standing remaining player inherits
  // it -- otherwise the lobby has a host id matching nobody and can never be
  // started again.
  if (!lobby.players.some((p) => p.id === lobby.hostPlayerId)) {
    const inheritor = [...lobby.players].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (inheritor) lobby.hostPlayerId = inheritor.id;
  }

  lobby.status = 'lobby';
  lobby.rounds = [];
  lobby.currentRoundIndex = 0;
  lobby.countdownEndsAt = null;
  lobby.roundDeadlineAt = null;
  lobby.winnerId = null;
  lobby.rematchBy = [];
  lobby.matchCount = (lobby.matchCount ?? 1) + 1;
  // Bumped so a client mid-poll notices the transition the same way it
  // notices a round change, rather than needing a separate signal.
  lobby.roundSeq++;
  void now;
}

/** Advances lobby state if a deadline has already passed -- run at the top
 * of every duel API handler so state self-heals even if nobody happened to
 * call in while a timer expired (see PLAN.md notes on tick-on-read). */
export function tick(lobby: DuelLobby, grader: Grader): void {
  const now = Date.now();
  if (lobby.status === 'countdown' && lobby.countdownEndsAt !== null && now >= lobby.countdownEndsAt) {
    lobby.status = 'playing';
    lobby.roundDeadlineAt = now + lobby.settings.timerSeconds * 1000;
  }
  if (lobby.status === 'playing' && lobby.roundDeadlineAt !== null && now >= lobby.roundDeadlineAt) {
    advanceRound(lobby, null, grader);
  }
}

/** Client-safe snapshot of a lobby -- never includes an unsettled round's
 * cityId/canonical name, only settled ones (matches PLAN.md: answer never
 * reaches the client until a round is over). */
export function buildPublicState(lobby: DuelLobby, grader: Grader) {
  const toLastRound = (index: number) => {
    const r = lobby.rounds[index];
    if (!r) return null;
    // Always includes the country, win or timeout. This is a shared broadcast
    // every player in the lobby sees -- unlike solo's individual grade()
    // feedback (untouched, see CLAUDE.md), there's no per-viewer distinction
    // to key off, and everyone but the solver still needs the country to
    // learn from the round.
    const canonicalName = grader.revealWithCountry(r.cityId);
    return { index, solvedByPlayerId: r.solvedByPlayerId, timedOut: r.timedOut, canonicalName };
  };

  // 'finished' is set by advanceRound() *without* incrementing
  // currentRoundIndex -- it still points at the round that was just won, so
  // that's the round to report as "last" (not currentRoundIndex - 1).
  const lastRoundIndex = lobby.status === 'finished' ? lobby.currentRoundIndex : lobby.currentRoundIndex - 1;

  const current = lobby.status === 'playing' ? lobby.rounds[lobby.currentRoundIndex] : null;

  // Full round-by-round history, for the post-match report's map + list.
  // Only sent once the duel is over -- every round is settled by then (the
  // winning round's solvedByPlayerId is set before status flips to
  // 'finished', see advanceRound), so this doesn't leak an in-progress
  // round's answer the way exposing it mid-match would.
  const rounds =
    lobby.status === 'finished'
      ? lobby.rounds.map((r, index) => {
          const city = grader.getCityRow(r.cityId);
          return {
            index,
            lat: r.lat,
            lon: r.lon,
            name: city?.canonical_name ?? 'Unknown',
            country: city?.country ?? '',
            solvedByPlayerId: r.solvedByPlayerId,
            timedOut: r.timedOut,
          };
        })
      : null;

  return {
    lobbyId: lobby.id,
    joinCode: lobby.joinCode,
    hostPlayerId: lobby.hostPlayerId,
    status: lobby.status,
    players: lobby.players.map((p) => ({ id: p.id, name: p.name, roundWins: p.roundWins })),
    settings: lobby.settings,
    countdownEndsAt: lobby.countdownEndsAt,
    roundDeadlineAt: lobby.roundDeadlineAt,
    roundSeq: lobby.roundSeq,
    currentRound: current
      ? {
          index: lobby.currentRoundIndex,
          lat: current.lat,
          lon: current.lon,
          minRenderZoom: current.minRenderZoom,
          // Safe to expose in full -- it's just player ids, not the answer --
          // so a reloading/rejoining client can show "2/4 reported" correctly.
          reportedBy: current.reportedBy,
        }
      : null,
    lastRound: lastRoundIndex >= 0 ? toLastRound(lastRoundIndex) : null,
    rounds,
    winnerId: lobby.winnerId,
    // Only meaningful on the end screen. `needed` counts players still
    // polling, not everyone who ever joined, so the tally a player reads
    // ("2 of 3 ready") matches the condition the server actually applies.
    rematch:
      lobby.status === 'finished'
        ? {
            requestedBy: lobby.rematchBy ?? [],
            needed: presentPlayers(lobby).map((p) => p.id),
          }
        : null,
  };
}

/** Grades a guess against the current round; on a correct, not-yet-settled
 * guess, advances the round crediting this player. Returns whether THIS
 * guess was the one that won the round (vs. the round already being settled
 * by someone else, or an incorrect guess). */
export function submitGuess(
  lobby: DuelLobby,
  playerId: string,
  guess: string,
  grader: Grader
): { correct: boolean; wonRound: boolean; canonicalName: string | null } {
  if (lobby.status !== 'playing') {
    return { correct: false, wonRound: false, canonicalName: null };
  }
  const current = lobby.rounds[lobby.currentRoundIndex];
  if (current.solvedByPlayerId || current.timedOut) {
    return { correct: false, wonRound: false, canonicalName: null };
  }
  const result = grader.grade(current.cityId, guess);
  if (!result.correct) {
    return { correct: false, wonRound: false, canonicalName: null };
  }
  advanceRound(lobby, playerId, grader);
  return { correct: true, wonRound: true, canonicalName: result.canonicalName };
}

/** "Report round": bad/unusable imagery, mirroring solo's Report Round
 * (reportedCities.ts, game/[gameId]/report/route.ts) -- same global
 * blocklist, same "swap in a fresh city in the same slot, no score change"
 * semantics -- but gated on *every* player in the lobby agreeing, since a
 * duel round is shared rather than one person's own game. Throws if
 * pickReplacementCity can't find one (caller should catch, same as solo's
 * report route does). */
export function reportRound(lobby: DuelLobby, playerId: string, grader: Grader): void {
  if (lobby.status !== 'playing') return;
  const current = lobby.rounds[lobby.currentRoundIndex];
  if (current.solvedByPlayerId || current.timedOut) return;
  if (!current.reportedBy.includes(playerId)) current.reportedBy.push(playerId);
  if (current.reportedBy.length < lobby.players.length) return;

  addReportedId(current.cityId);
  const excludeIds = new Set([...getReportedIds(), ...lobby.rounds.map((r) => r.cityId)]);
  const replacement = pickReplacementCity(
    lobby.settings.targetPopulation,
    grader,
    excludeIds,
    new Set(), // duels don't enforce cross-round country uniqueness -- see pickNextRound
    lobby.settings.onlyCoast
  );

  current.cityId = replacement.id;
  current.lat = replacement.lat;
  current.lon = replacement.lon;
  current.minRenderZoom = replacement.min_render_zoom;
  current.reportedBy = [];
  // Fresh timer -- time spent staring at unusable imagery shouldn't count
  // against the replacement, matching solo's accrue-then-zero.
  lobby.roundDeadlineAt = Date.now() + lobby.settings.timerSeconds * 1000;
}
