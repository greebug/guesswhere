import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, rateLimit, clientIp } from '@/lib/server/auth';
import { sendVerificationEmail, isEmailConfigured } from '@/lib/server/email';

export const runtime = 'nodejs';

// Resend the verification link for the signed-in user's own address.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: 'No email on this account' }, { status: 400 });
  if (user.email_verified === 1) return NextResponse.json({ ok: true, alreadyVerified: true });
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email is not configured on this server' }, { status: 503 });
  }
  if (rateLimit(`verify:${clientIp(request)}:${user.id}`, 5)) {
    return NextResponse.json({ error: 'Too many requests, try again later' }, { status: 429 });
  }

  const sent = await sendVerificationEmail(user.id, user.email);
  return NextResponse.json({ ok: sent });
}
