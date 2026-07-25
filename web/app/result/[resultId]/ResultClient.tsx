'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  rounds: (BreakdownRound & { lat: number; lon: number })[];
}

export default function ResultClient({ resultId }: { resultId: string }) {
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <div className="gw-panel px-8 py-6 text-center"><p className="gw-eyebrow text-gw-rose">Error</p><p className="mt-2 text-gw-ink">{error}</p></div>
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          Back to Guesswhere
        </Link>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex min-h-screen items-center justify-center ">
        <p className="gw-eyebrow gw-pulse-soft">Loading</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <div className="w-full max-w-xl">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          &larr; Guesswhere
        </Link>
      </div>

      <div className="w-full max-w-xl text-center">
        <h1 className="gw-display text-4xl font-black tracking-[0.08em]">{result.username}</h1>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatDuration(result.totalMs)}</p>
        <p className="mt-2 text-sm text-gw-mute">
          {formatPopulation(result.targetPopulation)}
          {result.onlyCoast ? ', coast only' : ''} &middot;{' '}
          {new Date(result.finishedAt).toLocaleDateString()}
        </p>
      </div>

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
