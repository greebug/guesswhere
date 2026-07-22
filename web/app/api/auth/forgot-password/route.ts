import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail, rateLimit, clientIp } from '@/lib/server/auth';
import { readUserByEmail } from '@/lib/server/gameDb';
import { sendPasswordResetEmail, isEmailConfigured } from '@/lib/server/email';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';

  // Identical response in every branch below -- if this endpoint distinguished
  // "no account" from "sent", it would be a way to enumerate who has an
  // account here.
  const ok = NextResponse.json({
    ok: true,
    message: "If an account with a verified email matches that address, we've sent a reset link.",
  });

  if (!email) return ok;
  if (rateLimit(`forgot:${clientIp(request)}`, 5)) return ok;
  if (rateLimit(`forgot-email:${email}`, 3)) return ok;
  if (!isEmailConfigured()) return ok;

  const user = readUserByEmail(email);
  // Unverified addresses can't be reset to. Otherwise signing up with someone
  // else's address would hand you a takeover path.
  if (user && user.email && user.email_verified === 1) {
    await sendPasswordResetEmail(user.id, user.email);
  }

  return ok;
}
