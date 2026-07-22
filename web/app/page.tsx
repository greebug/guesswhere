'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PRESETS = [50_000, 100_000, 500_000, 2_000_000];

export default function Home() {
  const router = useRouter();
  const [population, setPopulation] = useState('100000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startGame(targetPopulation: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/game/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPopulation }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'failed to start game');
      const data = await res.json();
      router.push(`/play/${data.gameId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-900 px-4 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Guesswhere</h1>
        <p className="mt-2 text-zinc-400">Pick a city size, then find 10 places from satellite imagery alone.</p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <label className="text-sm text-zinc-400">Approximate population</label>
        <input
          type="number"
          min={1}
          value={population}
          onChange={(e) => setPopulation(e.target.value)}
          className="w-48 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-lg"
        />
        <div className="flex gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPopulation(String(p))}
              className="rounded bg-zinc-700 px-2 py-1 text-xs hover:bg-zinc-600"
            >
              {p.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => startGame(Number(population))}
        disabled={loading || !Number(population)}
        className="rounded-full bg-white px-8 py-3 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
      >
        {loading ? 'Loading...' : 'Start Game'}
      </button>

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
