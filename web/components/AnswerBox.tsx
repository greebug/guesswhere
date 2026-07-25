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
}: AnswerBoxProps) {
  const [value, setValue] = useState('');
  const [shake, setShake] = useState(false);
  // One-shot flare on the transition into solved, not a permanent glow --
  // the celebration is the moment, the green is the state.
  const [flare, setFlare] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = solved || revealed;

  // Fresh input whenever this slot's city changes -- navigating to a
  // different round (switching to city #6 then back to #3 must not carry
  // over whatever was typed for #6), or a report-round replacement.
  useEffect(() => {
    setValue('');
    setShake(false);
    setFlare(false);
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
      setFlare(true);
      setTimeout(() => setFlare(false), 900);
    } else {
      playIncorrect();
      setValue('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  }

  const tone = solved
    ? { ring: 'rgb(46 230 197)', text: 'text-gw-teal', label: 'Found' }
    : revealed
      ? { ring: 'rgb(255 179 64)', text: 'text-gw-amber', label: 'Revealed' }
      : { ring: 'rgb(255 255 255 / 0.15)', text: 'text-gw-ink', label: null as string | null };

  return (
    <div className="flex items-center gap-3">
      <PagerButton direction="prev" onClick={onPrev} disabled={!canPrev} />

      <form onSubmit={submit} className="relative flex-1">
        {/* The status cap sits above the field rather than inside it, so a
            long "City, Country" answer never has to share a line with it. */}
        {tone.label && (
          <span
            className={`absolute -top-2.5 left-4 z-10 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${tone.text}`}
            style={{ borderColor: tone.ring, background: '#050b14' }}
          >
            {tone.label}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={settled ? (canonicalName ?? '') : value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={settled}
          placeholder="Where is this?"
          autoComplete="off"
          // No text color in the base string: `tone.text` is the ONLY color
          // class here on purpose. Two color utilities on one element don't
          // resolve by class-attribute order, they resolve by whichever
          // Tailwind happened to emit later in the stylesheet -- so listing a
          // default alongside the real one is a coin flip, not a fallback.
          className={`w-full rounded-2xl border-2 bg-black/70 px-6 py-4 text-center text-2xl font-semibold shadow-2xl outline-none backdrop-blur-md transition-all placeholder:font-normal placeholder:text-gw-faint ${
            settled ? '' : 'focus:border-gw-cyan/70'
          } ${shake ? 'animate-shake' : ''} ${flare ? 'gw-flare' : ''} ${tone.text}`}
          style={{
            borderColor: tone.ring,
            boxShadow: settled
              ? `0 0 40px -12px ${tone.ring}, inset 0 0 30px -18px ${tone.ring}`
              : '0 24px 48px -24px rgb(0 0 0 / 0.9)',
          }}
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
      className="gw-btn h-14 w-14 shrink-0 rounded-full text-xl backdrop-blur-md"
    >
      {direction === 'prev' ? '←' : '→'}
    </button>
  );
}
