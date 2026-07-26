import { NextResponse } from 'next/server';
import { getCurrentUser, toPublicUser, upgradeLegacySessionCookie } from '@/lib/server/auth';
import { isEmailConfigured } from '@/lib/server/email';

export const runtime = 'nodejs';

// Also the identity endpoint the other bingbongblitz.com games read: Blitz's
// server forwards a socket handshake's Cookie header here and takes the answer
// as authoritative, rather than trusting anything a client claims about itself.
export async function GET() {
  // Every page mounts useCurrentUser(), which calls this -- so a session left
  // over from before the cookie went domain-wide gets migrated on the first
  // page view, without anyone having to sign in again. Has to happen in a
  // route handler; `cookies().set` is a no-op during render.
  await upgradeLegacySessionCookie();

  const user = await getCurrentUser();
  return NextResponse.json({
    user: user ? toPublicUser(user) : null,
    // Lets the client hide "forgot password" / "verify email" affordances
    // entirely when no mail transport is configured (e.g. local dev).
    emailEnabled: isEmailConfigured(),
  });
}
