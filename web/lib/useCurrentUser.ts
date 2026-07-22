'use client';

import { useCallback, useEffect, useState } from 'react';

export interface CurrentUser {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
}

/** Who's signed in, from the httpOnly session cookie. The cookie itself is
 * unreadable by JS on purpose, so this is a fetch rather than a local lookup.
 * `loading` distinguishes "not signed in" from "don't know yet", which
 * matters -- rendering a signed-out state during the first tick makes the
 * header flicker on every page load. */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setUser(data.user);
      setEmailEnabled(Boolean(data.emailEnabled));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { user, emailEnabled, loading, refresh };
}
