import { NextRequest, NextResponse } from 'next/server';
import {
  createUser,
  findUserForLogin,
  startSession,
  toPublicUser,
  validateEmail,
  validatePassword,
  validateUsername,
  normalizeEmail,
  rateLimit,
  clientIp,
} from '@/lib/server/auth';
import { readUserByEmail } from '@/lib/server/gameDb';
import { sendVerificationEmail } from '@/lib/server/email';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (rateLimit(`signup:${clientIp(request)}`, 10)) {
    return NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  // Email is optional -- an account without one simply has no password-reset
  // path, which the signup form says out loud.
  const rawEmail = typeof body?.email === 'string' ? body.email.trim() : '';

  const usernameError = validateUsername(username);
  if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });

  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  let email: string | null = null;
  if (rawEmail) {
    const emailError = validateEmail(rawEmail);
    if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });
    email = normalizeEmail(rawEmail);
    if (readUserByEmail(email)) {
      return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
    }
  }

  if (findUserForLogin(username)) {
    return NextResponse.json({ error: 'That username is taken' }, { status: 409 });
  }

  let user;
  try {
    user = createUser(username, password, email);
  } catch {
    // UNIQUE violation from a request that raced the checks above.
    return NextResponse.json({ error: 'That username is taken' }, { status: 409 });
  }

  await startSession(user.id);

  // Best-effort: a mail failure must not undo a successful signup, since
  // email is optional and the account is already usable without it.
  let verificationSent = false;
  if (email) verificationSent = await sendVerificationEmail(user.id, email);

  return NextResponse.json({ user: toPublicUser(user), verificationSent });
}
