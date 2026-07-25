'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/basePath';

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
      const res = await fetch(api('/api/auth/reset-password'), {
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <h1 className="gw-display text-3xl">Password changed</h1>
        <p className="text-center text-gw-mute">
          You’ve been signed out everywhere. Sign in with your new password.
        </p>
        <Link
          href="/"
          className="mt-2 gw-cta px-6 py-2.5"
        >
          Back to Guesswhere
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <h1 className="gw-display text-3xl">Choose a new password</h1>

      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          autoFocus
          className="gw-input px-3 py-2"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className="gw-input px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy || !token}
          className="gw-cta px-6 py-2.5"
        >
          {busy ? 'Working…' : 'Set new password'}
        </button>
      </form>

      {!token && <p className="text-sm text-gw-vermilion">This link is missing its token.</p>}
      {error && <p className="text-sm text-gw-vermilion">{error}</p>}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ResetInner />
    </Suspense>
  );
}
