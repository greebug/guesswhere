import { NextRequest, NextResponse } from 'next/server';
import {
  findUserForLogin,
  startSession,
  toPublicUser,
  verifyPassword,
  rateLimit,
  clientIp,
} from '@/lib/server/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  // Keyed on both, so one attacker can't lock a victim out of their own
  // account by burning the username's budget from a single IP.
  if (rateLimit(`login:${clientIp(request)}:${username.toLowerCase()}`, 10)) {
    return NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 });
  }

  const user = findUserForLogin(username);
  // Same message either way -- distinguishing "no such user" from "wrong
  // password" tells an attacker which usernames exist.
  const invalid = NextResponse.json({ error: 'Incorrect username or password' }, { status: 401 });
  if (!user) return invalid;
  if (!verifyPassword(password, user.password_hash)) return invalid;

  await startSession(user.id);
  return NextResponse.json({ user: toPublicUser(user) });
}
