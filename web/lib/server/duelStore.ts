import type { DuelLobby } from './duelLogic';
import { putLobby, readLobby } from './gameDb';

export function saveLobby(lobby: DuelLobby): void {
  putLobby(lobby.id, JSON.stringify(lobby), lobby.createdAt);
}

export function getLobby(id: string): DuelLobby | undefined {
  const data = readLobby(id);
  if (!data) return undefined;
  return JSON.parse(data) as DuelLobby;
}
