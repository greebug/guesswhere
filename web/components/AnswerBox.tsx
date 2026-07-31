'use client';

import { useEffect, useRef, useState } from 'react';
import { playCorrect, playIncorrect } from '@/lib/sounds';

interface AnswerBoxProps {
  /** Changes when this slot's underlying city changes -- either navigating to
   * a different round, or a report-round replacement swapping the SAME index
   * to a new city. Either way the box must reset to empty/editable. */
  resetKey: string;
  solved: boolean;
  revealed: boolean;
  canonicalName: string | null;
  onGuess: (guess: string) => Promise<{ correct: boolean; canonicalName: string | null }>;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** Fires on focus/blur of the text field. Optional so a caller that doesn't
   * own a minimap (or doesn't care) can leave it off. */
  onFocusChange?: (focused: boolean) => void;
}

export default function AnswerBox({
  resetKey,
  solved,
  revealed,
  canonicalName,
  onGuess,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onFocusChange,
}: AnswerBoxProps) {
  const [value, setValue] = useState('');
  const [shake, setShake] = useState(false);
  // One-shot acknowledgement on the transition into solved, not a standing
  // glow -- the celebration is the moment, the color is the state.
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = solved || revealed;

  // Fresh input whenever this slot's city changes -- navigating to a
  // different round (switching to city #6 then back to #3 must not carry
  // over whatever was typed for #6), or a report-round replacement.
  useEffect(() => {
    setValue('');
    setShake(false);
    setFlash(false);
  }, [resetKey]);

  // Left/Right paginate between rounds -- but only when the answer box isn't
  // focused, since arrow keys inside a text input need to move the cursor,
  // not change rounds out from under whatever the player is typing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (document.activeElement === inputRef.current) return;
      if (e.key === 'ArrowLeft' && canPrev) onPrev();
      else if (e.key === 'ArrowRight' && canNext) onNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canPrev, canNext, onPrev, onNext]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (settled || !value.trim()) return;
    const result = await onGuess(value);
    if (result.correct) {
      playCorrect();
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
    } else {
      playIncorrect();
      setValue('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  }

  const tone = solved
    ? { edge: '#4fb9a5', text: 'text-gw-verdigris', label: 'Found' }
    : revealed
      ? { edge: '#d9a441', text: 'text-gw-ochre', label: 'Revealed' }
      : { edge: 'rgb(240 234 222 / 0.16)', text: 'text-gw-ink', label: null as string | null };

  return (
    <div className="flex items-center gap-2.5">
      <PagerButton direction="prev" onClick={onPrev} disabled={!canPrev} />

      <form onSubmit={submit} className="relative flex-1">
        {/* The status word sits above the field rather than inside it, so a
            long "City, Country" answer never shares a line with it. */}
        {tone.label && (
          <span
            className={`gw-eyebrow absolute -top-2 left-3 z-10 bg-gw-ground px-1.5 text-[10px] ${tone.text}`}
          >
            {tone.label}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={settled ? (canonicalName ?? '') : value}
          onChange={(e) => setValue(e.target.value)}
          // Typing a guess means reading the name off the minimap and
          // transcribing it, so focus holds the panel open -- see MiniMap's
          // `keepOpen`. Without it the loop was: click the field, move the
          // cursor onto the panel to make it appear, read, move back.
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          readOnly={settled}
          placeholder="Where is this?"
          autoComplete="off"
          // No text color in the base string: `tone.text` is the ONLY color
          // class here on purpose. Two color utilities on one element don't
          // resolve by class-attribute order, they resolve by whichever
          // Tailwind happened to emit later in the stylesheet -- so listing a
          // default alongside the real one is a coin flip, not a fallback.
          // text-lg on mobile, not smaller: iOS zooms the whole page in when a
          // focused input's text is under 16px, and this one is focused on
          // every single round.
          className={`w-full rounded-[6px] border bg-gw-ground/95 px-3 py-2.5 text-center text-lg outline-none transition-colors placeholder:text-gw-faint sm:px-6 sm:py-3.5 sm:text-2xl ${
            settled ? '' : 'focus:border-gw-verdigris/70'
          } ${shake ? 'animate-shake' : ''} ${flash ? 'gw-flash' : ''} ${tone.text}`}
          style={{ borderColor: tone.edge }}
        />
      </form>

      <PagerButton direction="next" onClick={onNext} disabled={!canNext} />
    </div>
  );
}

function PagerButton({
  direction,
  onClick,
  disabled,
}: {
  direction: 'prev' | 'next';
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'prev' ? 'Previous city' : 'Next city'}
      className="gw-btn h-11 w-11 shrink-0 bg-gw-ground/95 text-lg sm:h-12 sm:w-12"
    >
      {direction === 'prev' ? '←' : '→'}
    </button>
  );
}
