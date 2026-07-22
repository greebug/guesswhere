/** The population tiers that have leaderboards -- one tab each, with a
 * regular and a coast-only board inside.
 *
 * Deliberately an exact-match list rather than a bucketing: the population
 * setting is a MINIMUM, so a higher tier means bigger, more recognizable
 * cities and an easier game. Rounding a custom 137,000 game down into the
 * 100,000 board would let anyone hand-pick an easier setting and rank against
 * people who played the real one. Custom values still record to your profile;
 * they just have no board. */
export const BOARD_POPULATIONS = [50_000, 100_000, 500_000, 2_000_000] as const;

export function isBoardPopulation(n: number): boolean {
  return (BOARD_POPULATIONS as readonly number[]).includes(n);
}

export const LEADERBOARD_SIZE = 5;

/** m:ss, or h:mm:ss past an hour. Used everywhere a duration is shown. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compact tier label for tabs and result headers: "50k", "2M". */
export function formatPopulation(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}
