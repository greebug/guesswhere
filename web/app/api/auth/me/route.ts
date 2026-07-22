import { NextResponse } from 'next/server';
import { getCurrentUser, toPublicUser } from '@/lib/server/auth';
import { isEmailConfigured } from '@/lib/server/email';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({
    user: user ? toPublicUser(user) : null,
    // Lets the client hide "forgot password" / "verify email" affordances
    // entirely when no mail transport is configured (e.g. local dev).
    emailEnabled: isEmailConfigured(),
  });
}
