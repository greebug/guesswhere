'use client';

import Link from 'next/link';
import ResultMap from './ResultMap';
import { colorForPlayer, UNSOLVED_COLOR } from '@/lib/playerColors';

interface DuelReportPlayer {
  id: string;
  name: string;
  roundWins: number;
}

export interface DuelReportRound {
  index: number;
  lat: number;
  lon: number;
  name: string;
  country: string;
  solvedByPlayerId: string | null;
  timedOut: boolean;
}

/** "#ff5f7e" -> "255 95 126", the space-separated form the --gw-tone custom
 * property wants so it can be used with an alpha in rgb(). */
function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

interface DuelReportProps {
  players: DuelReportPlayer[];
  winnerId: string;
  rounds: DuelReportRound[];
}

/** Post-match duel screen, laid out to match the solo report / leaderboard
 * result page: a world map of the round set on top, a round-by-round list
 * below. Each round's dot and list entry are colored by whichever player
 * won it (grey for a timeout nobody solved), so the map reads as a visual
 * scoreboard at a glance. Replaces the whole duel screen rather than
 * overlaying it, same as the solo GameReport. */
export default function DuelReport({ players, winnerId, rounds }: DuelReportProps) {
  const winner = players.find((p) => p.id === winnerId);
  const winnerColor = colorForPlayer(players, winnerId);

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <div className="w-full max-w-xl">
        <Link href="/" className="gw-btn px-4 py-1.5 text-sm">
          Home
        </Link>
      </div>

      {/* The whole panel is lit in the winner's color -- the fastest possible
          read on "who won" before anyone parses a single number. */}
      <div
        className="gw-rise gw-panel w-full max-w-xl px-6 py-7 text-center"
        style={{ ['--gw-tone' as string]: hexToRgbTriplet(winnerColor) }}
      >
        <p className="gw-eyebrow">Match complete</p>
        <h1 className="mt-1 gw-display text-4xl" style={{ color: winnerColor }}>
          {winner ? `${winner.name} wins` : 'Match complete'}
        </h1>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {players.map((p) => {
            const color = colorForPlayer(players, p.id);
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
                style={{ borderColor: `${color}55`, background: `${color}14` }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                <span className="text-sm font-medium" style={{ color }}>
                  {p.name}
                </span>
                <span className="gw-num text-lg font-bold" style={{ color }}>
                  {p.roundWins}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="gw-rise w-full max-w-xl overflow-hidden rounded-md border border-gw-ink/10">
        <ResultMap
          dots={rounds.map((r) => ({
            name: r.name,
            lat: r.lat,
            lon: r.lon,
            color: colorForPlayer(players, r.solvedByPlayerId),
          }))}
        />
      </div>

      <div className="gw-panel w-full max-w-xl p-5">
        <h2 className="gw-eyebrow mb-3">Rounds</h2>
        <table className="w-full text-sm">
          <tbody>
            {rounds.map((r) => {
              const solver = players.find((p) => p.id === r.solvedByPlayerId);
              const color = solver ? colorForPlayer(players, solver.id) : UNSOLVED_COLOR;
              return (
                <tr key={r.index} className="border-b border-gw-ink/[0.07] last:border-0">
                  <td className="gw-num py-2 pr-2 text-xs text-gw-faint">{r.index + 1}</td>
                  <td className="py-2 pr-2" style={{ color }}>
                    {r.name}
                    {r.country && <span className="text-gw-faint">, {r.country}</span>}
                  </td>
                  <td className="py-2 text-right text-sm font-semibold" style={{ color }}>
                    {solver ? solver.name : 'Timed out'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
