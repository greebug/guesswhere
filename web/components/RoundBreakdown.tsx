'use client';

import { formatDuration } from '@/lib/boards';

export interface BreakdownRound {
  index: number;
  name: string;
  country: string;
  ms: number;
  solved: boolean;
  revealed: boolean;
}

/** The per-round time table. Shared by the end-of-game report and the
 * leaderboard result page so both read identically. */
export default function RoundBreakdown({ rounds }: { rounds: BreakdownRound[] }) {
  // Highlighting the slowest round is the single most interesting thing in
  // this table -- it's the city that actually cost you the run.
  const slowest = rounds.reduce((max, r) => Math.max(max, r.ms), 0);

  return (
    <table className="w-full text-sm">
      <tbody>
        {rounds.map((r) => (
          <tr key={r.index} className="border-b border-zinc-800 last:border-0">
            <td className="py-1.5 pr-2 tabular-nums text-zinc-600">{r.index + 1}</td>
            <td className="py-1.5 pr-2">
              <span className={r.revealed ? 'text-amber-400' : 'text-zinc-100'}>{r.name}</span>
              {r.country && <span className="text-zinc-500">, {r.country}</span>}
              {r.revealed && <span className="ml-2 text-xs text-amber-500">revealed</span>}
            </td>
            <td
              className={`py-1.5 text-right tabular-nums ${
                r.ms === slowest && slowest > 0 ? 'font-semibold text-white' : 'text-zinc-400'
              }`}
            >
              {formatDuration(r.ms)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
