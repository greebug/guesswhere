/**
 * Logs a request only when it was slow, with the process's resident memory
 * alongside it.
 *
 * Nothing in the duel path logged anything at all before this, so "my answer
 * took ten seconds to register" left no server-side trace whatsoever -- there
 * was no way to separate a slow handler from a slow network from a container
 * that had just restarted. Logging only the slow ones is what keeps this
 * readable: at 750ms polling per player, logging every request would bury the
 * signal it exists to surface.
 *
 * RSS is included because the leading suspect for a multi-second stall is
 * memory pressure -- the grader holds ~11k cities plus a name index and a
 * matcher per row, all in-process. If the slow lines cluster at a high and
 * climbing RSS, that's the answer; if RSS is flat while requests crawl, it
 * isn't, and the cause is downstream (volume I/O or event-loop contention).
 */
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 250);

export function logIfSlow(label: string, startedAt: number): void {
  const ms = Math.round(performance.now() - startedAt);
  if (ms < SLOW_MS) return;
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.warn(`[slow] ${label} ${ms}ms rss=${rssMb}MB`);
}
