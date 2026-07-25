'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDuration, formatPopulation } from '@/lib/boards';
import { api } from '@/lib/basePath';

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
    <div className="gw-panel flex-1 px-3 py-3 text-center">
      <div className="gw-num text-xl font-bold text-gw-verdigris">{value}</div>
      <div className="mt-0.5 text-xs text-gw-faint">{label}</div>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch(api('/api/profile'))
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'failed to load profile');
        return res.json();
      })
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load profile'));
  }, []);

  async function resendVerification() {
    setVerifyNotice(null);
    const res = await fetch(api('/api/auth/request-verify'), { method: 'POST' });
    const data = await res.json();
    setVerifyNotice(res.ok && data.ok ? 'Verification email sent.' : data.error ?? 'Could not send.');
  }

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
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center ">
        <p className="gw-eyebrow gw-breathe">Loading</p>
      </div>
    );
  }

  const { user, stats, recent } = profile;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <div className="w-full max-w-xl">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          &larr; Guesswhere
        </Link>
      </div>

      <h1 className="gw-display text-3xl">{user.username}</h1>

      {user.email && !user.emailVerified && (
        <div className="w-full max-w-xl rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          <p>
            <span className="font-semibold">{user.email}</span> isn’t verified yet — you won’t be
            able to reset your password until it is.
          </p>
          <button onClick={resendVerification} className="mt-1 underline hover:text-gw-ink">
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

      <div className="gw-panel w-full max-w-xl p-5">
        <h2 className="gw-eyebrow mb-3">
          Recent games
        </h2>
        {recent.length === 0 ? (
          <p className="py-3 text-sm text-gw-faint">
            No finished games yet. Times are recorded once all 10 rounds are settled.
          </p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((g) => (
              <li key={g.id} className="border-b border-gw-ink/[0.07] last:border-0">
                <Link
                  href={`/result/${g.id}`}
                  className="flex items-baseline gap-3 rounded px-2 py-2 text-sm hover:bg-gw-ink/5"
                >
                  <span className="gw-num font-medium text-gw-verdigris">
                    {formatDuration(g.totalMs)}
                  </span>
                  <span className="flex-1 text-gw-mute">
                    {formatPopulation(g.targetPopulation)}
                    {g.onlyCoast ? ', coast only' : ''}
                    {!g.eligible && <span className="ml-2 text-xs text-gw-faint">unranked</span>}
                  </span>
                  <span className="text-xs text-gw-faint">
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
