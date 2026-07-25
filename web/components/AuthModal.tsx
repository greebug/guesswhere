'use client';

import { useState } from 'react';
import { api } from '@/lib/basePath';

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
        const res = await fetch(api('/api/auth/forgot-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        setNotice(data.message ?? 'Check your email.');
        return;
      }

      const res = await fetch(api(`/api/auth/${mode}`), {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="gw-rise gw-panel gw-panel-lit w-full max-w-sm p-6"
        style={{ ['--gw-tone' as string]: '46 230 197' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gw-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="gw-btn h-7 w-7 rounded-full text-gw-mute"
          >
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
                className="gw-input px-3 py-2"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="gw-input px-3 py-2"
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
              className="gw-input px-3 py-2"
            />
          )}

          {mode === 'signup' && (
            // Said plainly rather than buried: without an email there is no
            // recovery path at all, and that's a surprising thing to discover
            // only once you've forgotten the password.
            <p className="text-xs leading-relaxed text-gw-faint">
              {emailEnabled
                ? 'Email is optional, but it’s the only way to reset your password if you forget it.'
                : 'Password reset isn’t available on this server, so keep your password somewhere safe.'}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="gw-cta mt-2 px-6 py-2.5"
          >
            {busy ? 'Working…' : title}
          </button>
        </form>

        {error && <p className="mt-3 rounded-lg border border-gw-rose/30 bg-gw-rose/10 px-3 py-2 text-sm text-gw-rose">{error}</p>}
        {notice && <p className="mt-3 rounded-lg border border-gw-teal/30 bg-gw-teal/10 px-3 py-2 text-sm text-gw-teal">{notice}</p>}

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gw-mute">
          {mode !== 'login' && (
            <button onClick={() => setMode('login')} className="underline decoration-gw-teal/40 underline-offset-4 transition hover:text-gw-teal">
              Sign in
            </button>
          )}
          {mode !== 'signup' && (
            <button onClick={() => setMode('signup')} className="underline decoration-gw-teal/40 underline-offset-4 transition hover:text-gw-teal">
              Create an account
            </button>
          )}
          {mode !== 'forgot' && emailEnabled && (
            <button onClick={() => setMode('forgot')} className="underline decoration-gw-teal/40 underline-offset-4 transition hover:text-gw-teal">
              Forgot password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
