'use client';

import Link from 'next/link';
import { useState } from 'react';

interface GameHeaderProps {
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
  onRecenter,
  onReveal,
  revealDisabled,
  onReport,
  reportPending,
  correctCount,
  totalRounds,
  currentSlide,
}: GameHeaderProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          onClick={copyLink}
          title="Share this link so a friend can play the same rounds with you"
          className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20"
        >
          {copied ? 'Copied!' : 'Copy Link'}
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
