// Fixed per-player palette for duel reports -- players are colored by their
// stable position in the lobby's players array (host first, then join
// order), so a player's color never changes mid-match. Six colors covers
// duels well past the realistic player count; it simply cycles beyond that.
export const PLAYER_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#a855f7', // violet
  '#ec4899', // pink
] as const;

// A round nobody solved (timed out) gets this instead of a player color.
export const UNSOLVED_COLOR = '#9ca3af'; // zinc-400

export function colorForPlayerIndex(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export function colorForPlayer(players: { id: string }[], playerId: string | null): string {
  if (!playerId) return UNSOLVED_COLOR;
  const index = players.findIndex((p) => p.id === playerId);
  return index === -1 ? UNSOLVED_COLOR : colorForPlayerIndex(index);
}
