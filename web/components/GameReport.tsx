'use client';

import Link from 'next/link';
import { useState } from 'react';
import ResultMap from './ResultMap';
import RoundBreakdown, { type BreakdownRound } from './RoundBreakdown';
import { formatDuration } from '@/lib/boards';

export interface ReportRound extends BreakdownRound {
  lat: number;
  lon: number;
}

export interface GameSummary {
  gameId: string;
  totalMs: number;
  eligible: boolean;
  ineligibleReason: string | null;
  rounds: ReportRound[];
}

/** Shown once every round is settled -- solved or given up on. Deliberately
 * laid out to match the leaderboard result page (ResultClient): a world map
 * of the round set on top, time-per-city below. Appears for guests too; only
 * the leaderboard line differs. Replaces the whole game screen rather than
 * overlaying it -- there's no "review the underlying single-round map"
 * action anymore, this map already shows the whole set. */
export default function GameReport({ summary }: { summary: GameSummary }) {
  const [copyState, setCopyState] = useState<'idle' | 'working' | 'copied'>('idle');
  const solved = summary.rounds.filter((r) => r.solved).length;

  async function shareCities() {
    setCopyState('working');
    try {
      const res = await fetch(`/api/game/${summary.gameId}/clone`, { method: 'POST' });
      if (!res.ok) throw new Error('failed to create share link');
      const data = await res.json();
      await navigator.clipboard.writeText(`${window.location.origin}/play/${data.gameId}`);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-900 px-4 py-10 text-white">
      <div className="flex w-full max-w-xl items-center justify-between">
        <Link href="/" className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20">
          Home
        </Link>
        <button
          onClick={shareCities}
          disabled={copyState === 'working'}
          title="Copy a link that gives a friend their own playthrough of these same 10 cities"
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20 disabled:opacity-30"
        >
          {copyState === 'copied' ? 'Copied!' : 'Share Cities'}
        </button>
      </div>

      <div className="w-full max-w-xl text-center">
        <h1 className="text-2xl font-bold">
          {solved === summary.rounds.length ? 'All 10 found' : `${solved} of ${summary.rounds.length} found`}
        </h1>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatDuration(summary.totalMs)}</p>

        {summary.eligible ? (
          <p className="mt-2 text-sm font-medium text-green-400">Submitted to the leaderboard</p>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Not ranked — {summary.ineligibleReason ?? 'this run doesn’t qualify'}
          </p>
        )}
      </div>

      <div className="w-full max-w-xl">
        <ResultMap dots={summary.rounds.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }))} />
      </div>

      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Time per city
        </h2>
        <RoundBreakdown rounds={summary.rounds} />
      </div>
    </div>
  );
}
