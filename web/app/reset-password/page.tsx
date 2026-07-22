'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError('Those passwords don’t match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reset failed');
      setDone(true);
      setTimeout(() => router.push('/'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-900 px-4 text-white">
        <h1 className="text-3xl font-bold">Password changed</h1>
        <p className="text-center text-zinc-400">
          You’ve been signed out everywhere. Sign in with your new password.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-full bg-white px-6 py-2 font-semibold text-black hover:bg-zinc-200"
        >
          Back to Guesswhere
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-900 px-4 text-white">
      <h1 className="text-3xl font-bold">Choose a new password</h1>

      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          autoFocus
          className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy || !token}
          className="rounded-full bg-white px-6 py-2 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Set new password'}
        </button>
      </form>

      {!token && <p className="text-sm text-red-400">This link is missing its token.</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-900" />}>
      <ResetInner />
    </Suspense>
  );
}
