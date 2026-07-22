import type { DuelLobby } from './duelLogic';
import { putLobby, readLobby, readLobbyByJoinCode } from './gameDb';

export function saveLobby(lobby: DuelLobby): void {
  putLobby(lobby.id, JSON.stringify(lobby), lobby.createdAt, lobby.joinCode);
}

export function getLobby(id: string): DuelLobby | undefined {
  const data = readLobby(id);
  if (!data) return undefined;
  return JSON.parse(data) as DuelLobby;
}

export function getLobbyByJoinCode(joinCode: string): DuelLobby | undefined {
  const data = readLobbyByJoinCode(joinCode);
  if (!data) return undefined;
  return JSON.parse(data) as DuelLobby;
}
