'use client';

import Link from 'next/link';
import { useState } from 'react';
import ResultMap from './ResultMap';
import RoundBreakdown, { type BreakdownRound } from './RoundBreakdown';
import { formatDuration } from '@/lib/boards';
import { api } from '@/lib/basePath';

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
  const perfect = solved === summary.rounds.length;

  async function shareCities() {
    setCopyState('working');
    try {
      const res = await fetch(api(`/api/game/${summary.gameId}/clone`), { method: 'POST' });
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
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <Link href="/" className="gw-btn px-4 py-1.5 text-sm">
          Home
        </Link>
        <button
          onClick={shareCities}
          disabled={copyState === 'working'}
          title="Copy a link that gives a friend their own playthrough of these same 10 cities"
          className={`gw-btn px-4 py-1.5 text-sm ${copyState === 'copied' ? 'gw-tone-teal' : ''}`}
        >
          {copyState === 'copied' ? '✓ Copied' : 'Share Cities'}
        </button>
      </div>

      {/* The scoreboard. The time is the hero here -- it's the number that
          goes on the leaderboard and the one people compare. */}
      <div
        className="gw-rise gw-panel gw-panel-lit w-full max-w-xl px-6 py-7 text-center"
        style={{ ['--gw-tone' as string]: perfect ? '46 230 197' : '255 179 64' }}
      >
        <p className="gw-eyebrow">{perfect ? 'Clean sweep' : 'Run complete'}</p>
        <h1 className="mt-1 text-xl font-bold text-gw-ink">
          {perfect ? 'All 10 found' : `${solved} of ${summary.rounds.length} found`}
        </h1>
        <p className="gw-display gw-num mt-3 text-6xl font-black">
          {formatDuration(summary.totalMs)}
        </p>

        {summary.eligible ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-gw-teal/40 bg-gw-teal/10 px-3 py-1 text-xs font-semibold text-gw-teal">
            <span className="h-1.5 w-1.5 rounded-full bg-gw-teal gw-pulse-soft" />
            Submitted to the leaderboard
          </p>
        ) : (
          <p className="mt-4 text-xs text-gw-faint">
            Not ranked — {summary.ineligibleReason ?? 'this run doesn’t qualify'}
          </p>
        )}
      </div>

      <div className="gw-rise w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_48px_-24px_rgb(0,0,0,0.9)]" style={{ animationDelay: '0.1s' }}>
        <ResultMap dots={summary.rounds.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }))} />
      </div>

      <div className="gw-rise gw-panel w-full max-w-xl p-5" style={{ animationDelay: '0.2s' }}>
        <h2 className="gw-eyebrow mb-3">Time per city</h2>
        <RoundBreakdown rounds={summary.rounds} />
      </div>
    </div>
  );
}
