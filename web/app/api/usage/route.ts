import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server/auth';
import { budgetState, isExempt, mapLoadHistory, currentPeriod } from '@/lib/server/usage';

export const runtime = 'nodejs';

/**
 * Where the month stands against the budget, plus the last year of history.
 *
 * Restricted to USAGE_EXEMPT_USERS rather than public: the number is a
 * reasonable proxy for how much traffic the game gets, and more usefully for
 * an attacker, it says exactly how much further the counter has to be pushed
 * to take the game offline.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!isExempt(user?.username)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const state = budgetState();
  return NextResponse.json({
    period: currentPeriod(),
    ...state,
    percentUsed: state.budget === 0 ? 100 : Math.round((state.used / state.budget) * 1000) / 10,
    history: mapLoadHistory(12),
  });
}
