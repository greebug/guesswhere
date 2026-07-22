'use client';

import { useState } from 'react';

type Mode = 'login' | 'signup' | 'forgot';

interface AuthModalProps {
  initialMode: Mode;
  emailEnabled: boolean;
  onClose: () => void;
  onSignedIn: () => void;
}

export default function AuthModal({
  initialMode,
  emailEnabled,
  onClose,
  onSignedIn,
}: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        setNotice(data.message ?? 'Check your email.');
        return;
      }

      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'signup' ? { username, password, email: email || undefined } : { username, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
      onSignedIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-white">
            &times;
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode !== 'forgot' && (
            <>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoComplete="username"
                autoFocus
                maxLength={20}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-white"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-white"
              />
            </>
          )}

          {(mode === 'signup' || mode === 'forgot') && emailEnabled && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === 'signup' ? 'Email (optional)' : 'Email'}
              autoComplete="email"
              autoFocus={mode === 'forgot'}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-white"
            />
          )}

          {mode === 'signup' && (
            // Said plainly rather than buried: without an email there is no
            // recovery path at all, and that's a surprising thing to discover
            // only once you've forgotten the password.
            <p className="text-xs leading-relaxed text-zinc-500">
              {emailEnabled
                ? 'Email is optional, but it’s the only way to reset your password if you forget it.'
                : 'Password reset isn’t available on this server, so keep your password somewhere safe.'}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-full bg-white px-6 py-2 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
          >
            {busy ? 'Working…' : title}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {notice && <p className="mt-3 text-sm text-green-400">{notice}</p>}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
          {mode !== 'login' && (
            <button onClick={() => setMode('login')} className="underline hover:text-white">
              Sign in
            </button>
          )}
          {mode !== 'signup' && (
            <button onClick={() => setMode('signup')} className="underline hover:text-white">
              Create an account
            </button>
          )}
          {mode !== 'forgot' && emailEnabled && (
            <button onClick={() => setMode('forgot')} className="underline hover:text-white">
              Forgot password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
