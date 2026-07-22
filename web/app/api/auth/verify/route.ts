import { NextRequest, NextResponse } from 'next/server';
import { hashToken } from '@/lib/server/auth';
import { readEmailToken, markEmailTokenUsed, updateUserEmail, readUserById } from '@/lib/server/gameDb';

export const runtime = 'nodejs';

// GET, because this is opened by clicking a link in an email.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const row = readEmailToken(hashToken(token));
  const invalid = NextResponse.json(
    { error: 'That verification link is invalid or has expired' },
    { status: 400 }
  );
  if (!row || row.kind !== 'verify') return invalid;
  if (row.used_at !== null) return invalid;
  if (row.expires_at < Date.now()) return invalid;

  const user = readUserById(row.user_id);
  if (!user) return invalid;

  // Verify the address the token was issued for, not whatever is currently on
  // the account -- if the email changed after the link was sent, that link is
  // stale and must not silently re-verify a different address.
  if (user.email !== row.email) return invalid;

  updateUserEmail(user.id, row.email, true);
  markEmailTokenUsed(row.token_hash, Date.now());

  return NextResponse.json({ ok: true, email: row.email });
}
