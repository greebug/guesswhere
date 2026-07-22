'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ResultMap from '@/components/ResultMap';
import RoundBreakdown, { type BreakdownRound } from '@/components/RoundBreakdown';
import { formatDuration, formatPopulation } from '@/lib/boards';

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
    fetch(`/api/result/${resultId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'result not found');
        return res.json();
      })
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load result'));
  }, [resultId]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-900 text-white">
        <p>{error}</p>
        <Link href="/" className="text-sm text-zinc-400 underline hover:text-white">
          Back to Guesswhere
        </Link>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-900 px-4 py-10 text-white">
      <div className="w-full max-w-xl">
        <Link href="/" className="text-sm text-zinc-500 underline hover:text-white">
          &larr; Guesswhere
        </Link>
      </div>

      <div className="w-full max-w-xl text-center">
        <h1 className="text-3xl font-bold">{result.username}</h1>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatDuration(result.totalMs)}</p>
        <p className="mt-2 text-sm text-zinc-400">
          {formatPopulation(result.targetPopulation)}
          {result.onlyCoast ? ', coast only' : ''} &middot;{' '}
          {new Date(result.finishedAt).toLocaleDateString()}
        </p>
      </div>

      <div className="w-full max-w-xl">
        <ResultMap dots={result.rounds.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }))} />
      </div>

      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Time per city
        </h2>
        <RoundBreakdown rounds={result.rounds} />
      </div>
    </div>
  );
}
