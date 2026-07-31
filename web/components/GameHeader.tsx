'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDuration } from '@/lib/boards';
import { api, BASE_PATH } from '@/lib/basePath';

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
    // gap-[5px] on mobile is worth the fiddliness: at 7px the track measures
    // 181px and the row it sits in needs 339 of an available 336, so a 360px
    // Android phone wrapped Recenter onto a third header row for the sake of
    // three pixels. 5px brings the whole row in with room to spare.
    <div className="flex h-7 items-center gap-[5px] px-1 sm:h-6 sm:gap-[7px]">
      {rounds.map((r, i) => {
        const state = r.solved ? 'solved' : r.revealed ? 'revealed' : 'open';
        const isCurrent = i === currentIndex;
        const fill =
          state === 'solved' ? '#4fb9a5' : state === 'revealed' ? '#d9a441' : 'transparent';
        return (
          // The button is a touch target, the span inside it is the pip. A bare
          // 9px button is a fine mouse target and a bad thumb one, and the pips
          // can't simply grow -- ten of them plus the readouts and Recenter have
          // to fit one 375px row. So the target grows vertically (the full
          // header row) where there IS spare space, and only slightly across.
          <button
            key={i}
            onClick={() => onJump(i)}
            aria-label={`Round ${i + 1}${state === 'open' ? '' : `, ${state}`}`}
            aria-current={isCurrent}
            title={`Round ${i + 1}`}
            className="grid h-7 w-[11px] shrink-0 place-items-center sm:h-6 sm:w-[9px]"
          >
            <span
              className="h-[11px] w-[11px] rounded-full border transition-colors sm:h-[9px] sm:w-[9px]"
              style={{
                background: fill,
                borderColor: state === 'open' ? 'rgb(240 234 222 / 0.35)' : fill,
                // Gap ring: ground-colored spacer, then a hairline. Painted
                // outside the box, so it costs no layout.
                boxShadow: isCurrent
                  ? '0 0 0 2.5px #0e141a, 0 0 0 3.5px rgb(240 234 222 / 0.6)'
                  : undefined,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

/** A labelled readout. Small caps label over a mono value -- the pattern the
 * whole app uses for anything that changes while you watch it. */
function Readout({
  label,
  children,
  muted = false,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 leading-none">
      <span className={`gw-eyebrow text-[9px] tracking-[0.12em] ${muted ? 'text-gw-ochre' : ''}`}>
        {label}
      </span>
      {/* One color class only, never a default alongside a state one: two
          same-layer utilities resolve by Tailwind's emit order, not by the
          order they appear in the attribute. */}
      <span className={`gw-num text-[15px] ${muted ? 'text-gw-faint' : 'text-gw-ink'}`}>
        {children}
      </span>
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

  // Derived, not passed in: this is exactly accrue()'s own condition for
  // crediting time (the round on screen must be unsettled), and the header
  // already has both halves of it. A separate prop threaded down from the
  // server would be a second source of truth for the same fact.
  const current = rounds[currentSlide - 1];
  const paused = !!current && (current.solved || current.revealed);

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
      // BASE_PATH explicitly: next.config's basePath rewrites <Link> and
      // router.push(), but a URL assembled by hand from window.location.origin
      // is just a string and gets no prefix -- so this copied a link to
      // bingbongblitz.com/play/... , which 404s.
      await navigator.clipboard.writeText(
        `${window.location.origin}${BASE_PATH}/play/${data.gameId}`
      );
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  }

  return (
    // Seven controls do not fit one 375px row, and this used to just run off
    // the right edge -- Reveal and Report were entirely off screen on a phone.
    // It wraps now: on mobile the nav/action buttons share the top row and the
    // middle group takes a full row of its own beneath them (`w-full` on a
    // flex-wrap child forces exactly that). `sm:` restores the single row.
    <div className="relative z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gw-ink/10 bg-gw-ground px-3 py-2">
      <div className="order-1 flex items-center gap-2">
        <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
          Home
        </Link>
        <button
          onClick={shareCities}
          disabled={copyState === 'working'}
          title="Copy a link that gives a friend their own playthrough of these same 10 cities"
          className={`gw-btn px-3 py-1.5 text-sm ${copyState === 'copied' ? 'gw-tone-verdigris' : ''}`}
        >
          {copyState === 'copied' ? 'Copied' : <>Share<span className="hidden sm:inline"> cities</span></>}
        </button>
      </div>

      {/* Pulled up beside Home on mobile so the middle group gets its own row;
          source order is restored at sm. */}
      <div className="order-2 flex items-center gap-2 sm:order-3">
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
          Report<span className="hidden sm:inline"> round</span>
        </button>
      </div>

      {/* flex-wrap here too: at 320px the track + Elapsed + Recenter still
          don't fit one line, and wrapping Recenter onto its own is better than
          picking a magic width for it. Self-adjusting rather than tuned. */}
      <div className="order-3 flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:order-2 sm:w-auto sm:flex-nowrap sm:justify-start sm:gap-5">
        <RoundTrack rounds={rounds} currentIndex={currentSlide - 1} onJump={onJump} />

        <span className="hidden h-7 w-px bg-gw-ink/10 sm:block" aria-hidden="true" />

        <div className="hidden sm:block">
          <Readout label="Found">
            {correctCount}
            <span className="text-gw-faint">/{totalRounds}</span>
          </Readout>
        </div>

        {/* The clock only runs on a round that is BOTH on screen and unsolved,
            so paging back to a settled one stops it entirely. That was
            invisible before -- the number simply froze, which reads as a bug
            or, worse, as a quiet advantage for anyone who noticed. Saying so
            outright makes it a normal part of the game (go ahead, take a
            breather) instead of a trick. */}
        <Readout label={paused ? 'Paused' : 'Elapsed'} muted={paused}>
          {formatDuration(elapsedMs)}
        </Readout>

        <button
          onClick={onRecenter}
          title="Snap back to the pinpointed view of this round's city"
          className="gw-btn gw-tone-indigo px-3 py-1.5 text-sm"
        >
          Recenter
        </button>
      </div>
    </div>
  );
}
