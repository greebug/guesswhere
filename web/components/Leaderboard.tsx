'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BOARD_POPULATIONS, formatDuration, formatPopulation } from '@/lib/boards';
import { api } from '@/lib/basePath';

interface Entry {
  id: string;
  username: string;
  total_ms: number;
  finished_at: number;
}

interface Board {
  population: number;
  onlyCoast: boolean;
  entries: Entry[];
}

/** Only the podium gets color -- gold, silver, bronze and then nothing. A rank
 * badge on every row would make a five-row list look like a ransom note. */
const RANK_TONE = ['#ffd76e', '#d6e2f5', '#e0a06a'];

function BoardColumn({ title, accent, entries }: { title: string; accent: string; entries: Entry[] }) {
  return (
    <div className="flex-1">
      <h3 className="gw-eyebrow mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="py-4 text-sm text-gw-faint">No times yet — be the first.</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {entries.map((e, i) => (
            <li key={e.id}>
              <Link
                href={`/result/${e.id}`}
                className="group flex items-baseline gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-gw-ink/[0.05]"
              >
                <span
                  className="gw-num w-4 text-center text-xs font-bold"
                  style={{ color: RANK_TONE[i] ?? 'var(--color-gw-faint)' }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-sm text-gw-ink/90 group-hover:text-gw-ink">
                  {e.username}
                </span>
                <span className="gw-num text-sm font-semibold text-gw-verdigris">
                  {formatDuration(e.total_ms)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [tab, setTab] = useState<number>(BOARD_POPULATIONS[1]);

  // One request for all eight lists, so flipping tabs is instant rather than
  // a round-trip each time.
  useEffect(() => {
    fetch(api('/api/leaderboard'))
      .then((r) => r.json())
      .then((d) => setBoards(d.boards))
      .catch(() => setBoards([]));
  }, []);

  const regular = boards?.find((b) => b.population === tab && !b.onlyCoast);
  const coast = boards?.find((b) => b.population === tab && b.onlyCoast);

  return (
    <div className="gw-panel w-full p-5">
      <div className="flex items-center justify-between">
        <h2 className="gw-display text-lg text-gw-ink">Fastest Times</h2>
        <span className="gw-eyebrow">Top 5</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {BOARD_POPULATIONS.map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            data-active={tab === p}
            className="gw-chip gw-num px-3 py-1 text-xs"
          >
            {formatPopulation(p)}
          </button>
        ))}
      </div>

      <hr className="gw-rule my-4" />

      {boards === null ? (
        <p className="py-8 text-center text-sm text-gw-faint">Loading…</p>
      ) : (
        <div className="flex gap-5">
          <BoardColumn title="All cities" accent="#4cc9ff" entries={regular?.entries ?? []} />
          <span className="w-px self-stretch bg-gradient-to-b from-transparent via-gw-ink/10 to-transparent" />
          <BoardColumn title="Coast only" accent="#2ee6c5" entries={coast?.entries ?? []} />
        </div>
      )}

      <p className="mt-5 text-center text-[11px] leading-relaxed text-gw-faint">
        Sign in and finish all 10 without revealing or reporting a round to rank.
      </p>
    </div>
  );
}
