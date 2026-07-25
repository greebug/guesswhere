'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthModal from './AuthModal';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { api } from '@/lib/basePath';

/** Sign-in state for the home page. Deliberately a modal rather than its own
 * route: starting a game should never require navigating away and back. */
export default function AuthMenu() {
  const { user, emailEnabled, loading, refresh } = useCurrentUser();
  const [modal, setModal] = useState<'login' | 'signup' | null>(null);

  async function logout() {
    await fetch(api('/api/auth/logout'), { method: 'POST' });
    refresh();
  }

  // Render nothing until we know -- flashing "Sign in" at a signed-in user on
  // every page load is worse than a beat of empty space.
  if (loading) return <div className="h-8" />;

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        {user ? (
          <>
            <Link
              href="/profile"
              className="gw-btn gw-tone-teal group px-3 py-1.5"
              title="Your profile and past runs"
            >
              {/* A live status dot rather than the words "signed in as" --
                  shorter, and it reads as a connection indicator, which fits
                  the rest of the console. */}
              <span className="h-1.5 w-1.5 rounded-full bg-gw-teal gw-pulse-soft" />
              <span className="font-semibold">{user.username}</span>
            </Link>
            <button onClick={logout} className="gw-btn px-3 py-1.5 text-gw-mute hover:text-gw-ink">
              Log out
            </button>
          </>
        ) : (
          <>
            <span className="gw-eyebrow hidden sm:inline">Guest</span>
            <button onClick={() => setModal('login')} className="gw-btn px-3 py-1.5">
              Sign in
            </button>
            <button
              onClick={() => setModal('signup')}
              className="gw-btn gw-tone-teal px-3 py-1.5"
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
