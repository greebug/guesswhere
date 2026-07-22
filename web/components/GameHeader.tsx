'use client';

import Link from 'next/link';
import { useState } from 'react';

interface GameHeaderProps {
  gameId: string;
  onRecenter: () => void;
  onReveal: () => void;
  revealDisabled: boolean;
  onReport: () => void;
  reportPending: boolean;
  correctCount: number;
  totalRounds: number;
  currentSlide: number; // 1-indexed, for display
}

// The original two buttons (recenter, reveal) plus Report Round, added at the
// user's request for unusable imagery (heavy cloud cover, etc.) -- distinct
// from Reveal, since reporting excludes the city from ALL future games too.
export default function GameHeader({
  gameId,
  onRecenter,
  onReveal,
  revealDisabled,
  onReport,
  reportPending,
  correctCount,
  totalRounds,
  currentSlide,
}: GameHeaderProps) {
  const [copyState, setCopyState] = useState<'idle' | 'working' | 'copied'>('idle');

  // Gives a friend their OWN independent playthrough of the same 10 cities --
  // not a live-shared session (an earlier version just copied this page's own
  // URL, which would mean a friend's guesses/reveals affected this game too;
  // that's not what was wanted, this clones a fresh unsolved copy instead).
  async function shareCities() {
    setCopyState('working');
    try {
      const res = await fetch(`/api/game/${gameId}/clone`, { method: 'POST' });
      if (!res.ok) throw new Error('failed to create share link');
      const data = await res.json();
      await navigator.clipboard.writeText(`${window.location.origin}/play/${data.gameId}`);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  }

  return (
    <div className="flex items-center justify-between bg-black/80 px-3 py-2 text-white">
      <Link href="/" className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20">
        New Game
      </Link>

      <div className="flex gap-4 text-sm tabular-nums">
        <span title="Correct out of 10">
          {correctCount}/{totalRounds} correct
        </span>
        <span title="Current slide">
          {currentSlide}/{totalRounds}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={shareCities}
          disabled={copyState === 'working'}
          title="Copy a link that gives a friend their own playthrough of these same 10 cities"
          className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-30"
        >
          {copyState === 'copied' ? 'Copied!' : 'Share Cities'}
        </button>
        <button onClick={onRecenter} className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20">
          Recenter
        </button>
        <button
          onClick={onReveal}
          disabled={revealDisabled}
          className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-30"
        >
          Reveal
        </button>
        <button
          onClick={onReport}
          disabled={reportPending}
          title="Bad or unusable imagery (e.g. heavy cloud cover) -- skips this round and excludes the city from all future games"
          className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-30"
        >
          Report Round
        </button>
      </div>
    </div>
  );
}
