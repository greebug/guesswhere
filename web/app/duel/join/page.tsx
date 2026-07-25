'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { api } from '@/lib/basePath';

export default function JoinDuel() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in: the server takes the name from the account and ignores
  // anything posted, so there's nothing to type.
  const needsName = !userLoading && !user;

  async function submit() {
    if (!code.trim() || (needsName && !name.trim())) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api('/api/duel/join-by-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), name: name.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'failed to join');
      const data = await res.json();
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

      <h1 className="gw-display text-4xl">Join a duel</h1>

      <div className="flex flex-col gap-2">
        <label className="gw-eyebrow text-center">Join Code</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          maxLength={4}
          placeholder="ABCD"
          autoFocus
          className="gw-input gw-num w-52 px-3 py-4 text-center text-4xl font-bold tracking-[0.35em] text-gw-verdigris uppercase"
        />
      </div>

      {user ? (
        <p className="text-sm text-gw-mute">
          Playing as <span className="font-semibold text-gw-verdigris">{user.username}</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="gw-eyebrow text-center">Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            maxLength={40}
            placeholder="Bob"
            className="gw-input w-64 px-3 py-2.5 text-center text-lg"
          />
        </div>
      )}

      <button
        onClick={submit}
        disabled={loading || userLoading || !code.trim() || (needsName && !name.trim())}
        className="gw-cta px-10 py-3.5"
      >
        {loading ? 'Joining...' : user ? 'Ready' : 'Play as Guest'}
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
