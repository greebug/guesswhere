'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ResultMap from '@/components/ResultMap';
import RoundBreakdown, { type BreakdownRound } from '@/components/RoundBreakdown';
import { formatDuration, formatPopulation } from '@/lib/boards';
import { api } from '@/lib/basePath';

interface ResultView {
  id: string;
  username: string;
  targetPopulation: number;
  onlyCoast: boolean;
  totalMs: number;
  eligible: boolean;
  finishedAt: number;
  /** Both null for results recorded before these were captured -- rendered as
   * "not recorded" rather than as a zero. */
  startedAt: number | null;
  pausedMs: number | null;
  rounds: (BreakdownRound & { lat: number; lon: number })[];
}

export default function ResultClient({ resultId }: { resultId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayState, setReplayState] = useState<'idle' | 'working' | 'failed'>('idle');
  const [replayError, setReplayError] = useState<string | null>(null);

  // Take on the exact cities behind this run, in the same order. Built from
  // the result's own snapshot rather than the original game session, so it
  // still works for a result whose session was pruned months ago.
  async function playThisSet() {
    setReplayState('working');
    setReplayError(null);
    try {
      const res = await fetch(api(`/api/result/${resultId}/replay`), { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'could not start that set');
      router.push(`/play/${data.gameId}`);
    } catch (e) {
      setReplayState('failed');
      setReplayError(e instanceof Error ? e.message : 'could not start that set');
    }
  }

  useEffect(() => {
    fetch(api(`/api/result/${resultId}`))
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'result not found');
        return res.json();
      })
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load result'));
  }, [resultId]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 ">
        <div className="gw-panel px-8 py-6 text-center"><p className="gw-eyebrow text-gw-vermilion">Error</p><p className="mt-2 text-gw-ink">{error}</p></div>
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          Back to Guesswhere
        </Link>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex min-h-screen items-center justify-center ">
        <p className="gw-eyebrow gw-breathe">Loading</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <div className="flex w-full max-w-xl items-start justify-between gap-3">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          &larr; Guesswhere
        </Link>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={playThisSet}
            disabled={replayState === 'working'}
            className="gw-btn gw-tone-verdigris px-3 py-1.5 text-sm"
          >
            {replayState === 'working' ? 'Starting…' : 'Play this set'}
          </button>
          <p className="text-right text-xs text-gw-mute">
            {replayError ?? 'Same ten cities · doesn’t rank'}
          </p>
        </div>
      </div>

      <div className="w-full max-w-xl text-center">
        <h1 className="gw-display text-3xl">{result.username}</h1>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatDuration(result.totalMs)}</p>
        <p className="mt-2 text-sm text-gw-mute">
          {formatPopulation(result.targetPopulation)}
          {result.onlyCoast ? ', coast only' : ''} &middot;{' '}
          {new Date(result.finishedAt).toLocaleDateString()}
        </p>
      </div>

      {/* The big number above is ACTIVE time -- the sum of the ten rounds,
          which only run while a round is both on screen and unsolved. That is
          what the leaderboard ranks and it is not changing. This strip is the
          context it was missing: how long the run took on the wall clock, and
          how much of that gap was the clock stopped. A game can be paused
          indefinitely by sitting on an already-solved round, so without this
          there was no way to tell a quick run from a long one taken in stages.
          Recorded and shown, never ranked. */}
      <ElapsedStrip
        totalMs={result.totalMs}
        startedAt={result.startedAt}
        finishedAt={result.finishedAt}
        pausedMs={result.pausedMs}
      />

      <div className="w-full max-w-xl">
        <ResultMap dots={result.rounds.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }))} />
      </div>

      <div className="gw-panel w-full max-w-xl p-5">
        <h2 className="gw-eyebrow mb-3">
          Time per city
        </h2>
        <RoundBreakdown rounds={result.rounds} />
      </div>
    </div>
  );
}

/** Active time vs. wall clock, side by side.
 *
 * `startedAt` is null for every result recorded before it was captured. Those
 * say "not recorded" rather than showing a computed zero -- an unknown and a
 * genuine zero are different claims, and the second one would be a lie about
 * runs that were set under a rule that never measured this. */
function ElapsedStrip({
  totalMs,
  startedAt,
  finishedAt,
  pausedMs,
}: {
  totalMs: number;
  startedAt: number | null;
  finishedAt: number;
  pausedMs: number | null;
}) {
  const wallMs = startedAt === null ? null : Math.max(0, finishedAt - startedAt);
  return (
    <div className="w-full max-w-xl">
      <div className="gw-rule mb-3" />
      <dl className="flex items-baseline justify-center gap-6 text-center sm:gap-10">
        <Stat label="Active" value={formatDuration(totalMs)} note="ranked" />
        <Stat
          label="Elapsed"
          value={wallMs === null ? '—' : formatDuration(wallMs)}
          note={wallMs === null ? 'not recorded' : 'start to finish'}
        />
        <Stat
          label="Paused"
          value={pausedMs === null ? '—' : formatDuration(pausedMs)}
          note={pausedMs === null ? 'not recorded' : 'clock stopped'}
        />
      </dl>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="gw-eyebrow text-[10px] text-gw-mute">{label}</dt>
      <dd className="gw-num mt-0.5 text-lg tabular-nums">{value}</dd>
      <p className="mt-0.5 text-[10px] text-gw-faint">{note}</p>
    </div>
  );
}
