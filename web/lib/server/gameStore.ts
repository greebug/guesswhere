import { randomUUID } from 'node:crypto';
import type { GameSession } from './gameLogic';

// In-memory session store: fine for "just me and my brother" on one
// long-running Node process. Two known limitations, both acceptable for now
// and worth revisiting before phase 4 (leaderboards) needs durability:
//  - state resets on server restart
//  - `next dev`'s hot reload can wipe module state on server-file edits
declare global {
  // eslint-disable-next-line no-var
  var __gameStore: Map<string, GameSession> | undefined;
}

const store: Map<string, GameSession> = global.__gameStore ?? new Map();
global.__gameStore = store;

export function saveGame(session: GameSession): void {
  store.set(session.id, session);
}

export function getGame(id: string): GameSession | undefined {
  return store.get(id);
}

export function newGameId(): string {
  return randomUUID();
}
