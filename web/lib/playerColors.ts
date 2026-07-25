// Fixed per-player palette for duel reports -- players are colored by their
// stable position in the lobby's players array (host first, then join
// order), so a player's color never changes mid-match. Six colors covers
// duels well past the realistic player count; it simply cycles beyond that.
// Tuned to the app's accent palette (see globals.css) rather than stock
// Tailwind 500s: these sit on near-black glass and on satellite imagery, so
// they need the extra luminance to hold up in both places.
export const PLAYER_COLORS = [
  '#ff5f7e', // rose
  '#4cc9ff', // cyan
  '#2ee6c5', // teal
  '#ffb340', // amber
  '#9d7bff', // violet
  '#ff8ad4', // pink
] as const;

// A round nobody solved (timed out) gets this instead of a player color.
export const UNSOLVED_COLOR = '#6c7d99';

export function colorForPlayerIndex(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export function colorForPlayer(players: { id: string }[], playerId: string | null): string {
  if (!playerId) return UNSOLVED_COLOR;
  const index = players.findIndex((p) => p.id === playerId);
  return index === -1 ? UNSOLVED_COLOR : colorForPlayerIndex(index);
}
