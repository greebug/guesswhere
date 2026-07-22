import { randomUUID } from 'node:crypto';
import type { GameSession } from './gameLogic';
import { putGame, readGame } from './gameDb';

export function saveGame(session: GameSession): void {
  putGame(session.id, JSON.stringify(session), session.createdAt);
}

export function getGame(id: string): GameSession | undefined {
  const data = readGame(id);
  if (!data) return undefined;
  return JSON.parse(data) as GameSession;
}

export function newGameId(): string {
  return randomUUID();
}
