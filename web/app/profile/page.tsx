'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDuration, formatPopulation } from '@/lib/boards';

interface RecentGame {
  id: string;
  targetPopulation: number;
  onlyCoast: boolean;
  totalMs: number;
  eligible: boolean;
  finishedAt: number;
}

interface ProfileView {
  user: { username: string; email: string | null; emailVerified: boolean };
  stats: { games: number; eligible: number; avgMs: number | null; bestMs: number | null };
  recent: RecentGame[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-center">
      <div className="text-xl font-bold tabular-nums text-white">{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'failed to load profile');
        return res.json();
      })
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load profile'));
  }, []);

  async function resendVerification() {
    setVerifyNotice(null);
    const res = await fetch('/api/auth/request-verify', { method: 'POST' });
    const data = await res.json();
    setVerifyNotice(res.ok && data.ok ? 'Verification email sent.' : data.error ?? 'Could not send.');
  }

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
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
        <p>Loading…</p>
      </div>
    );
  }

  const { user, stats, recent } = profile;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-900 px-4 py-10 text-white">
      <div className="w-full max-w-xl">
        <Link href="/" className="text-sm text-zinc-500 underline hover:text-white">
          &larr; Guesswhere
        </Link>
      </div>

      <h1 className="text-3xl font-bold">{user.username}</h1>

      {user.email && !user.emailVerified && (
        <div className="w-full max-w-xl rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          <p>
            <span className="font-semibold">{user.email}</span> isn’t verified yet — you won’t be
            able to reset your password until it is.
          </p>
          <button onClick={resendVerification} className="mt-1 underline hover:text-white">
            Resend verification email
          </button>
          {verifyNotice && <p className="mt-1 text-amber-100">{verifyNotice}</p>}
        </div>
      )}

      <div className="flex w-full max-w-xl gap-3">
        <Stat label="Games finished" value={String(stats.games)} />
        <Stat label="Ranked runs" value={String(stats.eligible)} />
        <Stat label="Average" value={stats.avgMs === null ? '—' : formatDuration(stats.avgMs)} />
        <Stat label="Best" value={stats.bestMs === null ? '—' : formatDuration(stats.bestMs)} />
      </div>

      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Recent games
        </h2>
        {recent.length === 0 ? (
          <p className="py-3 text-sm text-zinc-600">
            No finished games yet. Times are recorded once all 10 rounds are settled.
          </p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((g) => (
              <li key={g.id} className="border-b border-zinc-800 last:border-0">
                <Link
                  href={`/result/${g.id}`}
                  className="flex items-baseline gap-3 rounded px-2 py-2 text-sm hover:bg-white/5"
                >
                  <span className="tabular-nums font-medium text-white">
                    {formatDuration(g.totalMs)}
                  </span>
                  <span className="flex-1 text-zinc-400">
                    {formatPopulation(g.targetPopulation)}
                    {g.onlyCoast ? ', coast only' : ''}
                    {!g.eligible && <span className="ml-2 text-xs text-zinc-600">unranked</span>}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {new Date(g.finishedAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
