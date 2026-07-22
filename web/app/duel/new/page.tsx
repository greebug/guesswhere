'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { formatThousands, parseDigits } from '@/lib/format';
import { BOARD_POPULATIONS } from '@/lib/boards';

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function NewDuel() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [name, setName] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(300);
  const [targetRounds, setTargetRounds] = useState(5);
  const [population, setPopulation] = useState('100000');
  const [onlyCoast, setOnlyCoast] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createLobby() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/duel/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          timerSeconds,
          targetRounds,
          targetPopulation: Number(population),
          onlyCoast,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'failed to create lobby');
      const data = await res.json();
      // Cached per-lobby so a refresh doesn't lose your seat (see duelLogic.ts --
      // no accounts yet, playerId is the only identity a client has).
      localStorage.setItem(`duel:${data.lobbyId}:playerId`, data.playerId);
      router.push(`/duel/${data.lobbyId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-900 px-4 py-8 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Duels</h1>
        <p className="mt-2 text-zinc-400">Create a lobby, share the link, race to solve rounds first.</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-5">
        {user ? (
          <p className="text-center text-sm text-zinc-400">
            Hosting as <span className="font-semibold text-white">{user.username}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Alice"
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-lg"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">Round timer: {formatTimer(timerSeconds)}</label>
          <input
            type="range"
            min={30}
            max={600}
            step={15}
            value={timerSeconds}
            onChange={(e) => setTimerSeconds(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">
            First to {targetRounds} round{targetRounds === 1 ? '' : 's'} wins
          </label>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={targetRounds}
            onChange={(e) => setTargetRounds(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <label className="text-sm text-zinc-400">Population Threshold</label>
          <input
            type="text"
            inputMode="numeric"
            value={formatThousands(population)}
            onChange={(e) => setPopulation(parseDigits(e.target.value))}
            className="w-48 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-lg"
          />
          <div className="flex gap-2">
            {BOARD_POPULATIONS.map((p) => (
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

        <label className="flex items-center justify-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={onlyCoast}
            onChange={(e) => setOnlyCoast(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
          />
          Only Coast (within 20mi of a coastline)
        </label>
      </div>

      <button
        onClick={createLobby}
        disabled={loading || userLoading || (!user && !name.trim())}
        className="rounded-full bg-white px-8 py-3 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Lobby'}
      </button>

      {!user && !userLoading && (
        <p className="text-sm text-zinc-500">
          or{' '}
          <Link href="/" className="underline hover:text-zinc-300">
            sign in
          </Link>{' '}
          to use your account name
        </p>
      )}

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
