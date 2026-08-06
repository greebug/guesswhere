import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server/auth';
import { listAccounts, setAccountExempt } from '@/lib/server/gameDb';
import { isAdmin, isExempt } from '@/lib/server/usage';

export const runtime = 'nodejs';

/**
 * The account roster, and the switch for exempting someone from the usage
 * limits without a redeploy.
 *
 * Restricted to USAGE_EXEMPT_USERS (the env list), not to everyone who happens
 * to be exempt: a whitelisted friend can skip the limits but must not be able
 * to whitelist further people, or the list grows on its own and the ceiling
 * stops meaning anything.
 *
 * 404 rather than 403 for everyone else -- there's no reason to confirm the
 * endpoint exists to someone who can't use it.
 *
 * Email ADDRESSES are deliberately never returned. Whether an account has a
 * verified one is useful (it says who can self-serve a password reset); the
 * address itself is not needed to decide who to whitelist.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!isAdmin(user?.username)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const accounts = listAccounts().map((a) => ({
    username: a.username,
    createdAt: a.created_at,
    hasVerifiedEmail: a.email_verified === 1,
    games: a.games,
    lastPlayedAt: a.last_played_at,
    exempt: isExempt(a.username),
    // Root accounts are exempt by configuration and can't be revoked here --
    // the UI equivalent of a greyed-out checkbox.
    exemptSource: isAdmin(a.username) ? 'env' : a.usage_exempt === 1 ? 'granted' : null,
  }));

  return NextResponse.json({ count: accounts.length, accounts });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdmin(user?.username)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  if (!username) return NextResponse.json({ error: 'username is required' }, { status: 400 });
  if (typeof body?.exempt !== 'boolean') {
    return NextResponse.json({ error: 'exempt must be true or false' }, { status: 400 });
  }

  if (isAdmin(username) && body.exempt === false) {
    return NextResponse.json(
      { error: `${username} is exempt via USAGE_EXEMPT_USERS; remove them there instead` },
      { status: 409 }
    );
  }

  if (!setAccountExempt(username, body.exempt)) {
    return NextResponse.json({ error: `no account named ${username}` }, { status: 404 });
  }

  return NextResponse.json({ username, exempt: body.exempt });
}
