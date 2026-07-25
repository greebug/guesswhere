'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDuration } from '@/lib/boards';
import { api } from '@/lib/basePath';

interface HeaderRound {
  solved: boolean;
  revealed: boolean;
}

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
  /** Per-round settle state, for the progress track. */
  rounds: HeaderRound[];
  /** Jump straight to a round from the track -- the same navigation the
   * answer box's arrows do, just random-access. */
  onJump: (index: number) => void;
  /** Total active time so far. Shown live so being timed is visible during
   * the game rather than a surprise on the end-of-game report. */
  elapsedMs: number;
}

/** The ten-round progress track. Each pip carries two pieces of information at
 * once -- settled state by color (teal found / amber revealed / dim pending)
 * and current position by the ring around it -- which is what lets it replace
 * the old "6/10" text rather than just decorate it. */
function RoundTrack({
  rounds,
  currentIndex,
  onJump,
}: {
  rounds: HeaderRound[];
  currentIndex: number;
  onJump: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {rounds.map((r, i) => {
        const state = r.solved ? 'solved' : r.revealed ? 'revealed' : 'open';
        const isCurrent = i === currentIndex;
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            aria-label={`Round ${i + 1}${state === 'open' ? '' : `, ${state}`}`}
            aria-current={isCurrent}
            title={`Round ${i + 1}`}
            className={`h-2.5 w-2.5 rounded-full transition-all duration-200 hover:scale-125 ${
              state === 'solved'
                ? 'bg-gw-teal shadow-[0_0_10px_rgb(46,230,197,0.8)]'
                : state === 'revealed'
                  ? 'bg-gw-amber shadow-[0_0_10px_rgb(255,179,64,0.7)]'
                  : 'bg-white/25'
            } ${isCurrent ? 'scale-150 ring-2 ring-white/70 ring-offset-2 ring-offset-black/60' : ''}`}
          />
        );
      })}
    </div>
  );
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
  rounds,
  onJump,
  elapsedMs,
}: GameHeaderProps) {
  const [copyState, setCopyState] = useState<'idle' | 'working' | 'copied'>('idle');

  // Gives a friend their OWN independent playthrough of the same 10 cities --
  // not a live-shared session (an earlier version just copied this page's own
  // URL, which would mean a friend's guesses/reveals affected this game too;
  // that's not what was wanted, this clones a fresh unsolved copy instead).
  async function shareCities() {
    setCopyState('working');
    try {
      const res = await fetch(api(`/api/game/${gameId}/clone`), { method: 'POST' });
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
    <div className="relative z-30 flex items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-b from-black/90 to-black/70 px-3 py-2 text-gw-ink backdrop-blur-xl">
      {/* A lit hairline along the bottom edge -- the seam between the console
          and the world it looks out on. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-gw-teal/50 to-transparent"
      />

      <div className="flex items-center gap-2">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          Home
        </Link>
        <button
          onClick={shareCities}
          disabled={copyState === 'working'}
          title="Copy a link that gives a friend their own playthrough of these same 10 cities"
          className={`gw-btn px-3 py-1.5 text-sm ${copyState === 'copied' ? 'gw-tone-teal' : ''}`}
        >
          {copyState === 'copied' ? '✓ Copied' : 'Share Cities'}
        </button>
      </div>

      <div className="flex items-center gap-4">
        <RoundTrack rounds={rounds} currentIndex={currentSlide - 1} onJump={onJump} />

        <span className="hidden h-7 w-px bg-white/10 sm:block" aria-hidden="true" />

        <div className="hidden flex-col items-end leading-none sm:flex">
          <span className="gw-eyebrow text-[9px]">Found</span>
          <span className="gw-num text-sm font-semibold text-gw-teal">
            {correctCount}
            <span className="text-gw-faint">/{totalRounds}</span>
          </span>
        </div>

        <div className="flex flex-col items-end leading-none">
          <span className="gw-eyebrow text-[9px]">Elapsed</span>
          <span
            className="gw-num text-lg font-semibold text-gw-ink"
            style={{ textShadow: '0 0 18px rgb(46 230 197 / 0.5)' }}
          >
            {formatDuration(elapsedMs)}
          </span>
        </div>

        <button
          onClick={onRecenter}
          title="Snap back to the pinpointed view of this round's city"
          className="gw-btn gw-tone-cyan px-3 py-1.5 text-sm"
        >
          🎯 Recenter
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onReveal}
          disabled={revealDisabled}
          title="Give up on this round and show the answer"
          className="gw-btn gw-tone-amber px-3 py-1.5 text-sm"
        >
          👁 Reveal
        </button>
        <button
          onClick={onReport}
          disabled={reportPending}
          title="Bad or unusable imagery (e.g. heavy cloud cover) -- skips this round and excludes the city from all future games"
          className="gw-btn gw-tone-rose px-3 py-1.5 text-sm"
        >
          🚩 Report Round
        </button>
      </div>
    </div>
  );
}
