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
  // Set once the account exists and there is something the user still has to
  // act on. Replaces the form rather than sitting under it -- see `submit`.
  const [afterSignup, setAfterSignup] = useState<string | null>(null);

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

      // Signing up with an email mails a verification link, and confirming the
      // address is the ONLY thing that makes password reset possible later.
      // This used to close the modal the instant the account existed, so the
      // link was never mentioned -- accounts sat unverified until the day the
      // password was forgotten, which is exactly when it's too late to fix.
      // Stay open and say so; the account is already created and signed in
      // either way, so this costs nothing but a dismissal.
      if (mode === 'signup' && email) {
        onSignedIn();
        setAfterSignup(
          data.verificationSent
            ? `You're signed in. We've emailed ${email} a link to confirm the address — open it to turn on password reset. Until then, a forgotten password can't be recovered.`
            : `You're signed in, but we couldn't email ${email} just now. Resend the confirmation from your profile — until the address is confirmed, a forgotten password can't be recovered.`
        );
        return;
      }

      onSignedIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password';
  // Separate from `title`, which doubles as the submit button's label.
  const heading = afterSignup ? 'Account created' : title;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gw-ground/80 px-4"
      onClick={onClose}
    >
      <div
        className="gw-rise gw-panel w-full max-w-sm p-6"
        style={{ ['--gw-tone' as string]: '79 185 165' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gw-ink">{heading}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="gw-btn h-7 w-7 rounded-full text-gw-mute"
          >
            &times;
          </button>
        </div>

        {afterSignup && (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg border border-gw-verdigris/30 bg-gw-verdigris/10 px-3 py-2 text-sm leading-relaxed text-gw-verdigris">
              {afterSignup}
            </p>
            <button onClick={onClose} className="gw-cta px-6 py-2.5">
              Got it
            </button>
          </div>
        )}

        {!afterSignup && (
        <>
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

        {error && <p className="mt-3 rounded-lg border border-gw-vermilion/30 bg-gw-vermilion/10 px-3 py-2 text-sm text-gw-vermilion">{error}</p>}
        {notice && <p className="mt-3 rounded-lg border border-gw-verdigris/30 bg-gw-verdigris/10 px-3 py-2 text-sm text-gw-verdigris">{notice}</p>}

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gw-mute">
          {mode !== 'login' && (
            <button onClick={() => setMode('login')} className="underline decoration-gw-verdigris/40 underline-offset-4 transition hover:text-gw-verdigris">
              Sign in
            </button>
          )}
          {mode !== 'signup' && (
            <button onClick={() => setMode('signup')} className="underline decoration-gw-verdigris/40 underline-offset-4 transition hover:text-gw-verdigris">
              Create an account
            </button>
          )}
          {mode !== 'forgot' && emailEnabled && (
            <button onClick={() => setMode('forgot')} className="underline decoration-gw-verdigris/40 underline-offset-4 transition hover:text-gw-verdigris">
              Forgot password?
            </button>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
