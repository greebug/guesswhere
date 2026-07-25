'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/basePath';

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    fetch(api(`/api/auth/verify?token=${encodeURIComponent(token)}`))
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Verification failed');
        setState('ok');
        setMessage(`${data.email} is verified.`);
      })
      .catch((e) => {
        setState('error');
        setMessage(e instanceof Error ? e.message : 'Verification failed');
      });
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="gw-display text-3xl">
        {state === 'working' ? 'Verifying…' : state === 'ok' ? 'Email verified' : 'Link not valid'}
      </h1>
      {message && <p className="text-center text-gw-mute">{message}</p>}
      {state === 'ok' && (
        <p className="text-center text-sm text-gw-faint">You can now reset your password by email.</p>
      )}
      <Link
        href="/"
        className="mt-2 gw-cta px-6 py-2.5"
      >
        Back to Guesswhere
      </Link>
    </div>
  );
}

// useSearchParams needs a Suspense boundary -- without one the whole route
// opts into client-side rendering at build time and Next fails the build.
export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <VerifyInner />
    </Suspense>
  );
}
