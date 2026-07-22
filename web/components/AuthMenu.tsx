'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthModal from './AuthModal';
import { useCurrentUser } from '@/lib/useCurrentUser';

/** Sign-in state for the home page. Deliberately a modal rather than its own
 * route: starting a game should never require navigating away and back. */
export default function AuthMenu() {
  const { user, emailEnabled, loading, refresh } = useCurrentUser();
  const [modal, setModal] = useState<'login' | 'signup' | null>(null);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    refresh();
  }

  // Render nothing until we know -- flashing "Sign in" at a signed-in user on
  // every page load is worse than a beat of empty space.
  if (loading) return <div className="h-6" />;

  return (
    <>
      <div className="flex items-center gap-4 text-sm">
        {user ? (
          <>
            <span className="text-zinc-400">
              Signed in as <span className="font-semibold text-white">{user.username}</span>
            </span>
            <Link href="/profile" className="text-zinc-400 underline hover:text-white">
              Profile
            </Link>
            <button onClick={logout} className="text-zinc-400 underline hover:text-white">
              Log out
            </button>
          </>
        ) : (
          <>
            <span className="text-zinc-500">Playing as guest</span>
            <button
              onClick={() => setModal('login')}
              className="text-zinc-400 underline hover:text-white"
            >
              Sign in
            </button>
            <button
              onClick={() => setModal('signup')}
              className="text-zinc-400 underline hover:text-white"
            >
              Create account
            </button>
          </>
        )}
      </div>

      {modal && (
        <AuthModal
          initialMode={modal}
          emailEnabled={emailEnabled}
          onClose={() => setModal(null)}
          onSignedIn={refresh}
        />
      )}
    </>
  );
}
