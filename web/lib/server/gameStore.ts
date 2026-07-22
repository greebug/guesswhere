import { randomUUID } from 'node:crypto';
import type { GameSession } from './gameLogic';
import { putGame, readGame } from './gameDb';

export function saveGame(session: GameSession): void {
  putGame(session.id, JSON.stringify(session), session.createdAt);
}

/**
 * Fills in fields that postdate a stored session. Sessions are persisted as
 * JSON blobs, so games created before timing/accounts existed simply lack
 * these keys -- defaulting on read means no data migration and no broken
 * in-flight games.
 *
 * An old game resumes with a zeroed clock rather than a retroactively
 * invented one, and `activeSince: null` means it accrues nothing until the
 * client's first focus call.
 */
function normalizeSession(session: Partial<GameSession> & { id: string }): GameSession {
  const s = session as GameSession;
  s.rounds = (s.rounds ?? []).map((r) => ({ ...r, elapsedMs: r.elapsedMs ?? 0 }));
  s.userId = s.userId ?? null;
  s.activeRoundIndex = s.activeRoundIndex ?? null;
  s.activeSince = s.activeSince ?? null;
  s.usedReveal = s.usedReveal ?? false;
  s.usedReport = s.usedReport ?? false;
  s.isClone = s.isClone ?? false;
  s.finishedAt = s.finishedAt ?? null;
  return s;
}

export function getGame(id: string): GameSession | undefined {
  const data = readGame(id);
  if (!data) return undefined;
  return normalizeSession(JSON.parse(data));
}

export function newGameId(): string {
  return randomUUID();
}
