import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, hashToken, validatePassword, rateLimit, clientIp } from '@/lib/server/auth';
import {
  readEmailToken,
  markEmailTokenUsed,
  updateUserPassword,
  deleteSessionsForUser,
  readUserById,
} from '@/lib/server/gameDb';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (rateLimit(`reset:${clientIp(request)}`, 10)) {
    return NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const row = readEmailToken(hashToken(token));
  const invalid = NextResponse.json(
    { error: 'That reset link is invalid or has expired' },
    { status: 400 }
  );
  if (!row || row.kind !== 'reset') return invalid;
  if (row.used_at !== null) return invalid;
  if (row.expires_at < Date.now()) return invalid;

  const user = readUserById(row.user_id);
  if (!user) return invalid;

  updateUserPassword(user.id, hashPassword(password));
  markEmailTokenUsed(row.token_hash, Date.now());
  // Sign out everywhere. If the reason for the reset is that someone else
  // knows the old password, leaving their session alive defeats the point.
  deleteSessionsForUser(user.id);

  return NextResponse.json({ ok: true });
}
