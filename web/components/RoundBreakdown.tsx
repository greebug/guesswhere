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
        {rounds.map((r) => {
          // A bar behind each row, scaled to that round's share of the
          // slowest one. Turns a column of timestamps into a shape you can
          // read at a glance -- which is the actual question being asked
          // here ("where did the time go?"), not "how long was round 4".
          const share = slowest > 0 ? (r.ms / slowest) * 100 : 0;
          const isSlowest = r.ms === slowest && slowest > 0;
          return (
            <tr key={r.index} className="border-b border-gw-ink/[0.07] last:border-0">
              <td className="w-6 py-2 pr-2">
                <span
                  className={`gw-num block text-center text-[11px] font-bold ${
                    r.revealed ? 'text-gw-ochre' : 'text-gw-faint'
                  }`}
                >
                  {r.index + 1}
                </span>
              </td>
              <td className="relative py-2 pr-3">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1 left-0 -z-10 rounded-r-sm"
                  style={{
                    width: `${share}%`,
                    background: r.revealed
                      ? 'linear-gradient(90deg, rgb(255 179 64 / 0.22), transparent)'
                      : 'linear-gradient(90deg, rgb(46 230 197 / 0.18), transparent)',
                  }}
                />
                <span className={r.revealed ? 'text-gw-ochre' : 'text-gw-ink'}>{r.name}</span>
                {r.country && <span className="text-gw-faint">, {r.country}</span>}
                {r.revealed && (
                  <span className="ml-2 rounded border border-gw-ochre/30 px-1 text-[9px] font-semibold tracking-wide text-gw-ochre uppercase">
                    revealed
                  </span>
                )}
              </td>
              <td
                className={`gw-num py-2 text-right ${
                  isSlowest ? 'font-bold text-gw-ink' : 'text-gw-mute'
                }`}
              >
                {formatDuration(r.ms)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
