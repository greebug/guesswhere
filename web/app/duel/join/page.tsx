'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JoinDuel() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!code.trim() || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/duel/join-by-code', {
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-900 px-4 text-white">
      <h1 className="text-4xl font-bold">Join Duel</h1>

      <div className="flex flex-col gap-2">
        <label className="text-center text-sm text-zinc-400">Join Code</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          maxLength={4}
          placeholder="ABCD"
          autoFocus
          className="w-40 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-3xl tracking-[0.3em] uppercase"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-center text-sm text-zinc-400">Your name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          maxLength={40}
          placeholder="Bob"
          className="w-64 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-lg"
        />
      </div>

      <button
        onClick={submit}
        disabled={loading || !code.trim() || !name.trim()}
        className="rounded-full bg-white px-8 py-3 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
      >
        {loading ? 'Joining...' : 'Ready'}
      </button>

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
