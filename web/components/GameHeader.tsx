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

/** The ten-round progress track. Each pip carries two things at once: settle
 * state by fill (verdigris found / ochre revealed / hollow open) and current
 * position by the ring around it.
 *
 * The ring is a box-shadow rather than Tailwind's `ring` + `ring-offset`, and
 * the pips don't scale. Both are for the same reason: the first version used
 * `scale-150 ring-2 ring-offset-2`, which pushed the current pip past the
 * header's own height and clipped it. A box-shadow ring paints outside the
 * element's box without affecting layout, and the row below reserves the
 * space it needs. */
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
    <div className="flex h-6 items-center gap-[7px] px-1">
      {rounds.map((r, i) => {
        const state = r.solved ? 'solved' : r.revealed ? 'revealed' : 'open';
        const isCurrent = i === currentIndex;
        const fill =
          state === 'solved' ? '#4fb9a5' : state === 'revealed' ? '#d9a441' : 'transparent';
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            aria-label={`Round ${i + 1}${state === 'open' ? '' : `, ${state}`}`}
            aria-current={isCurrent}
            title={`Round ${i + 1}`}
            className="h-[9px] w-[9px] shrink-0 rounded-full border transition-colors"
            style={{
              background: fill,
              borderColor:
                state === 'open' ? 'rgb(240 234 222 / 0.35)' : fill,
              // Gap ring: ground-colored spacer, then a hairline. Painted
              // outside the box, so it costs no layout.
              boxShadow: isCurrent
                ? '0 0 0 2.5px #0e141a, 0 0 0 3.5px rgb(240 234 222 / 0.6)'
                : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/** A labelled readout. Small caps label over a mono value -- the pattern the
 * whole app uses for anything that changes while you watch it. */
function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-0.5 leading-none">
      <span className="gw-eyebrow text-[9px] tracking-[0.12em]">{label}</span>
      <span className="gw-num text-[15px] text-gw-ink">{children}</span>
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
    <div className="relative z-30 flex items-center justify-between gap-4 border-b border-gw-ink/10 bg-gw-ground px-3 py-2">
      <div className="flex items-center gap-2">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          Home
        </Link>
        <button
          onClick={shareCities}
          disabled={copyState === 'working'}
          title="Copy a link that gives a friend their own playthrough of these same 10 cities"
          className={`gw-btn px-3 py-1.5 text-sm ${copyState === 'copied' ? 'gw-tone-verdigris' : ''}`}
        >
          {copyState === 'copied' ? 'Copied' : 'Share cities'}
        </button>
      </div>

      <div className="flex items-center gap-5">
        <RoundTrack rounds={rounds} currentIndex={currentSlide - 1} onJump={onJump} />

        <span className="hidden h-7 w-px bg-gw-ink/10 sm:block" aria-hidden="true" />

        <div className="hidden sm:block">
          <Readout label="Found">
            {correctCount}
            <span className="text-gw-faint">/{totalRounds}</span>
          </Readout>
        </div>

        <Readout label="Elapsed">{formatDuration(elapsedMs)}</Readout>

        <button
          onClick={onRecenter}
          title="Snap back to the pinpointed view of this round's city"
          className="gw-btn gw-tone-indigo px-3 py-1.5 text-sm"
        >
          Recenter
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onReveal}
          disabled={revealDisabled}
          title="Give up on this round and show the answer"
          className="gw-btn gw-tone-ochre px-3 py-1.5 text-sm"
        >
          Reveal
        </button>
        <button
          onClick={onReport}
          disabled={reportPending}
          title="Bad or unusable imagery (e.g. heavy cloud cover) -- skips this round and excludes the city from all future games"
          className="gw-btn gw-tone-vermilion px-3 py-1.5 text-sm"
        >
          Report round
        </button>
      </div>
    </div>
  );
}
