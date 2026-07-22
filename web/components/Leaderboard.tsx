'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BOARD_POPULATIONS, formatDuration, formatPopulation } from '@/lib/boards';

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

function BoardColumn({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <div className="flex-1">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h3>
      {entries.length === 0 ? (
        <p className="py-3 text-sm text-zinc-600">No times yet — be the first.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {entries.map((e, i) => (
            <li key={e.id}>
              <Link
                href={`/result/${e.id}`}
                className="flex items-baseline gap-2 rounded px-2 py-1 text-sm hover:bg-white/5"
              >
                <span className="w-4 tabular-nums text-zinc-600">{i + 1}</span>
                <span className="flex-1 truncate text-zinc-200">{e.username}</span>
                <span className="tabular-nums font-medium text-white">
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
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((d) => setBoards(d.boards))
      .catch(() => setBoards([]));
  }, []);

  const regular = boards?.find((b) => b.population === tab && !b.onlyCoast);
  const coast = boards?.find((b) => b.population === tab && b.onlyCoast);

  return (
    <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-center text-lg font-bold text-white">Fastest Times</h2>

      <div className="mb-4 flex justify-center gap-1">
        {BOARD_POPULATIONS.map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            className={`rounded px-3 py-1 text-sm ${
              tab === p ? 'bg-white font-semibold text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {formatPopulation(p)}
          </button>
        ))}
      </div>

      {boards === null ? (
        <p className="py-6 text-center text-sm text-zinc-600">Loading…</p>
      ) : (
        <div className="flex gap-6">
          <BoardColumn title="All cities" entries={regular?.entries ?? []} />
          <BoardColumn title="Coast only" entries={coast?.entries ?? []} />
        </div>
      )}

      <p className="mt-4 text-center text-xs leading-relaxed text-zinc-600">
        Sign in and finish all 10 without revealing or reporting a round to rank.
      </p>
    </div>
  );
}
