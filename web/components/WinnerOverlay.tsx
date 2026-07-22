'use client';

import Link from 'next/link';

interface WinnerOverlayProps {
  winnerName: string;
  players: { id: string; name: string; roundWins: number }[];
}

export default function WinnerOverlay({ winnerName, players }: WinnerOverlayProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="animate-winner-pop rounded-2xl bg-white px-12 py-10 text-center shadow-2xl">
        <p className="text-5xl font-extrabold text-zinc-900">{winnerName} wins!</p>
        <div className="mt-6 flex justify-center gap-6 text-lg text-zinc-600">
          {players.map((p) => (
            <span key={p.id}>
              {p.name}: {p.roundWins}
            </span>
          ))}
        </div>
        <Link
          href="/"
          className="mt-8 inline-block rounded-full bg-zinc-900 px-8 py-3 font-semibold text-white hover:bg-zinc-700"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
