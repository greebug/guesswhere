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
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = solved || revealed;

  // Fresh input whenever this slot's city changes -- navigating to a
  // different round (switching to city #6 then back to #3 must not carry
  // over whatever was typed for #6), or a report-round replacement.
  useEffect(() => {
    setValue('');
    setShake(false);
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
    } else {
      playIncorrect();
      setValue('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Previous city"
        className="rounded-full bg-black/60 px-4 py-4 text-xl text-white hover:bg-black/80 disabled:opacity-30"
      >
        &larr;
      </button>

      <form onSubmit={submit} className="flex-1">
        <input
          ref={inputRef}
          type="text"
          value={settled ? canonicalName ?? '' : value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={settled}
          placeholder="Where is this?"
          autoComplete="off"
          className={`w-full rounded-lg border-4 px-6 py-4 text-center text-2xl font-medium shadow-xl outline-none transition-colors ${
            solved
              ? 'border-green-500 bg-green-50 text-green-900'
              : revealed
                ? 'border-amber-500 bg-amber-50 text-amber-900'
                : 'border-gray-300 bg-white text-black focus:border-blue-400'
          } ${shake ? 'animate-shake' : ''}`}
        />
      </form>

      <button
        onClick={onNext}
        disabled={!canNext}
        aria-label="Next city"
        className="rounded-full bg-black/60 px-4 py-4 text-xl text-white hover:bg-black/80 disabled:opacity-30"
      >
        &rarr;
      </button>
    </div>
  );
}
