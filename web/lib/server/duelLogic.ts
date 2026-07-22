import { randomUUID } from 'node:crypto';
import type { Grader } from './grader';
import { pickReplacementCity } from './gameLogic';

const COUNTDOWN_MS = 5000;

export interface Player {
  id: string;
  name: string;
  roundWins: number;
  joinedAt: number;
}

export interface DuelRound {
  cityId: number;
  lat: number;
  lon: number;
  minRenderZoom: number;
  solvedByPlayerId: string | null;
  timedOut: boolean;
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

export function createLobby(hostName: string, settings: DuelSettings, joinCode: string): DuelLobby {
  const host: Player = { id: newPlayerId(), name: hostName, roundWins: 0, joinedAt: Date.now() };
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
  };
}

export function addPlayer(lobby: DuelLobby, name: string): Player {
  const player: Player = { id: newPlayerId(), name, roundWins: 0, joinedAt: Date.now() };
  lobby.players.push(player);
  return player;
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
    // Timed out (nobody solved it) gets the country appended, same as solo
    // reveal -- a solved round doesn't, the winner already knew the country.
    const canonicalName = r.timedOut
      ? grader.revealWithCountry(r.cityId)
      : (grader.getCityRow(r.cityId)?.canonical_name ?? null);
    return { index, solvedByPlayerId: r.solvedByPlayerId, timedOut: r.timedOut, canonicalName };
  };

  // 'finished' is set by advanceRound() *without* incrementing
  // currentRoundIndex -- it still points at the round that was just won, so
  // that's the round to report as "last" (not currentRoundIndex - 1).
  const lastRoundIndex = lobby.status === 'finished' ? lobby.currentRoundIndex : lobby.currentRoundIndex - 1;

  const current = lobby.status === 'playing' ? lobby.rounds[lobby.currentRoundIndex] : null;

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
      ? { index: lobby.currentRoundIndex, lat: current.lat, lon: current.lon, minRenderZoom: current.minRenderZoom }
      : null,
    lastRound: lastRoundIndex >= 0 ? toLastRound(lastRoundIndex) : null,
    winnerId: lobby.winnerId,
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
