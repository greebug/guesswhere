'use client';

import Link from 'next/link';

interface DuelPlayer {
  id: string;
  name: string;
  roundWins: number;
}

interface DuelHeaderProps {
  players: DuelPlayer[];
  targetRounds: number;
  selfPlayerId: string | null;
  remainingSeconds: number | null;
  onRecenter: () => void;
}

const TIMER_CRITICAL_S = 10;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function DuelHeader({ players, targetRounds, selfPlayerId, remainingSeconds, onRecenter }: DuelHeaderProps) {
  const critical = remainingSeconds !== null && remainingSeconds <= TIMER_CRITICAL_S;

  return (
    <div className="flex items-center justify-between bg-black/80 px-3 py-2 text-white">
      <Link href="/" className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20">
        Home
      </Link>

      <div className="flex items-center gap-4 text-sm">
        <div className="flex gap-3 tabular-nums">
          {players.map((p) => (
            <span
              key={p.id}
              className={`rounded px-2 py-1 ${p.id === selfPlayerId ? 'bg-white/20 font-semibold' : ''}`}
            >
              {p.name}: {p.roundWins}
            </span>
          ))}
        </div>
        <span className="text-zinc-400">first to {targetRounds}</span>
        {remainingSeconds !== null && (
          <span
            className={`rounded px-2 py-1 font-bold tabular-nums ${
              critical ? 'animate-timer-critical bg-red-600 text-white' : 'bg-white/10'
            }`}
          >
            {formatTime(Math.max(0, remainingSeconds))}
          </span>
        )}
      </div>

      <button onClick={onRecenter} className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20">
        Recenter
      </button>
    </div>
  );
}
