import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail, rateLimit, clientIp } from '@/lib/server/auth';
import { readUserByEmail } from '@/lib/server/gameDb';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  isEmailConfigured,
} from '@/lib/server/email';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';

  // Identical response in every branch below -- if this endpoint distinguished
  // "no account" from "sent", it would be a way to enumerate who has an
  // account here.
  const ok = NextResponse.json({
    ok: true,
    message:
      "If an account matches that address, we've emailed it a link. If the address was " +
      'never confirmed, that email confirms it first — open it, then ask for the reset again.',
  });

  if (!email) return ok;
  if (rateLimit(`forgot:${clientIp(request)}`, 5)) return ok;
  if (rateLimit(`forgot-email:${email}`, 3)) return ok;
  if (!isEmailConfigured()) return ok;

  const user = readUserByEmail(email);
  if (user && user.email) {
    if (user.email_verified === 1) {
      await sendPasswordResetEmail(user.id, user.email);
    } else {
      // Unverified addresses still can't be reset to -- signing up with
      // someone else's address must never hand you a takeover path -- but
      // sending NOTHING here was a dead end: reset needs a verified address,
      // and /request-verify needs a session you can't get without the
      // password you're trying to reset. Accounts that never confirmed their
      // email were unrecoverable, and the identical response below meant
      // nobody could tell that was why.
      //
      // Mailing the verification link instead breaks the loop without
      // weakening the gate: only the mailbox owner can open it, which is the
      // same thing a reset link relies on, and verifying grants no session on
      // its own (app/api/auth/verify) -- it just marks the address confirmed
      // so a second request here can send the real reset link.
      await sendVerificationEmail(user.id, user.email, 'reset');
    }
  }

  return ok;
}
