'use client';

import Link from 'next/link';
import RoundBreakdown, { type BreakdownRound } from './RoundBreakdown';
import { formatDuration } from '@/lib/boards';

export interface GameSummary {
  gameId: string;
  totalMs: number;
  eligible: boolean;
  ineligibleReason: string | null;
  rounds: BreakdownRound[];
}

interface GameReportProps {
  summary: GameSummary;
  onClose: () => void;
}

/** Shown once every round is settled -- solved or given up on. Appears for
 * guests too; only the leaderboard line differs. */
export default function GameReport({ summary, onClose }: GameReportProps) {
  const solved = summary.rounds.filter((r) => r.solved).length;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 px-4 py-8">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white">
            {solved === summary.rounds.length ? 'All 10 found' : `${solved} of ${summary.rounds.length} found`}
          </h2>
          <p className="mt-1 text-4xl font-bold tabular-nums text-white">
            {formatDuration(summary.totalMs)}
          </p>

          {summary.eligible ? (
            <p className="mt-2 text-sm font-medium text-green-400">Submitted to the leaderboard</p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">
              Not ranked — {summary.ineligibleReason ?? 'this run doesn’t qualify'}
            </p>
          )}
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Time per city
          </h3>
          <RoundBreakdown rounds={summary.rounds} />
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-white px-6 py-2 font-semibold text-black hover:bg-zinc-200"
          >
            New Game
          </Link>
          <button
            onClick={onClose}
            className="rounded-full bg-white/10 px-6 py-2 text-white hover:bg-white/20"
          >
            Review Map
          </button>
        </div>
      </div>
    </div>
  );
}
