'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { formatThousands, parseDigits } from '@/lib/format';
import { BOARD_POPULATIONS } from '@/lib/boards';
import { api } from '@/lib/basePath';

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
      const res = await fetch(api('/api/duel/new'), {
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          <span aria-hidden="true">←</span> Guesswhere
        </Link>
      </div>

      <div className="text-center">
        <h1 className="gw-display text-4xl">Duels</h1>
        <p className="mt-3 max-w-sm text-sm text-gw-mute">Create a lobby, share the join code, race to solve rounds first.</p>
      </div>

      <details className="gw-panel w-full max-w-sm px-4 py-3 text-sm text-gw-mute">
        <summary className="cursor-pointer font-medium text-gw-ink marker:text-gw-verdigris">How duels differ from solo</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-4">
          <li>Rounds don&apos;t follow solo&apos;s &quot;no two cities share a country&quot; rule -- each round is picked independently, so the same country can come up more than once in a match.</li>
          <li>There&apos;s no Reveal button. A round nobody solves before the timer runs out is shown to everyone automatically instead.</li>
          <li>Report Round exists here too, but it only skips the round once <em>every</em> player has reported it -- not just one.</li>
          <li>Duels don&apos;t feed the solo leaderboards -- it&apos;s a separate mode, scored by first-to-N round wins instead.</li>
        </ul>
      </details>

      <div className="flex w-full max-w-sm flex-col gap-5">
        {user ? (
          <p className="text-center text-sm text-gw-mute">
            Hosting as <span className="font-semibold text-gw-verdigris">{user.username}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="gw-eyebrow">Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Alice"
              className="gw-input px-3 py-2.5 text-center text-lg"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm text-gw-mute">Round timer: {formatTimer(timerSeconds)}</label>
          <input
            type="range" className="gw-range"
            min={30}
            max={600}
            step={15}
            value={timerSeconds}
            onChange={(e) => setTimerSeconds(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-gw-mute">
            First to {targetRounds} round{targetRounds === 1 ? '' : 's'} wins
          </label>
          <input
            type="range" className="gw-range"
            min={1}
            max={15}
            step={1}
            value={targetRounds}
            onChange={(e) => setTargetRounds(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <label className="gw-eyebrow">Minimum population</label>
          <input
            type="text"
            inputMode="numeric"
            value={formatThousands(population)}
            onChange={(e) => setPopulation(parseDigits(e.target.value))}
            className="gw-input gw-num w-52 px-3 py-2.5 text-center text-2xl font-semibold text-gw-verdigris"
          />
          <div className="flex gap-2">
            {BOARD_POPULATIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPopulation(String(p))}
                className="gw-chip gw-num px-2.5 py-1 text-xs"
              >
                {p.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-center gap-2 text-sm text-gw-mute">
          <input
            type="checkbox"
            checked={onlyCoast}
            onChange={(e) => setOnlyCoast(e.target.checked)}
            className="gw-check"
          />
          Only Coast (within 20mi of a coastline)
        </label>
      </div>

      <button
        onClick={createLobby}
        disabled={loading || userLoading || (!user && !name.trim())}
        className="gw-cta px-10 py-3.5"
      >
        {loading ? 'Creating...' : 'Create Lobby'}
      </button>

      {!user && !userLoading && (
        <p className="text-sm text-gw-faint">
          or{' '}
          <Link href="/" className="underline decoration-gw-verdigris/40 underline-offset-4 transition hover:text-gw-verdigris">
            sign in
          </Link>{' '}
          to use your account name
        </p>
      )}

      {error && <p className="rounded-lg border border-gw-vermilion/30 bg-gw-vermilion/10 px-4 py-2 text-sm text-gw-vermilion">{error}</p>}
    </div>
  );
}
