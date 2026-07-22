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
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-900 px-4 py-10 text-white">
      <div className="w-full max-w-xl">
        <Link href="/" className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20">
          Home
        </Link>
      </div>

      <div className="w-full max-w-xl text-center">
        <h1 className="text-3xl font-bold" style={{ color: winnerColor }}>
          {winner ? `${winner.name} Won!` : 'Match complete'}
        </h1>
        <div className="mt-3 flex justify-center gap-6 text-lg font-medium">
          {players.map((p) => (
            <span key={p.id} style={{ color: colorForPlayer(players, p.id) }}>
              {p.name}: {p.roundWins}
            </span>
          ))}
        </div>
      </div>

      <div className="w-full max-w-xl">
        <ResultMap
          dots={rounds.map((r) => ({
            name: r.name,
            lat: r.lat,
            lon: r.lon,
            color: colorForPlayer(players, r.solvedByPlayerId),
          }))}
        />
      </div>

      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Rounds</h2>
        <table className="w-full text-sm">
          <tbody>
            {rounds.map((r) => {
              const solver = players.find((p) => p.id === r.solvedByPlayerId);
              const color = solver ? colorForPlayer(players, solver.id) : UNSOLVED_COLOR;
              return (
                <tr key={r.index} className="border-b border-zinc-800 last:border-0">
                  <td className="py-1.5 pr-2 tabular-nums text-zinc-600">{r.index + 1}</td>
                  <td className="py-1.5 pr-2" style={{ color }}>
                    {r.name}
                    {r.country && <span className="text-zinc-500">, {r.country}</span>}
                  </td>
                  <td className="py-1.5 text-right font-semibold" style={{ color }}>
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
