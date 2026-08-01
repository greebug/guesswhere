'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthMenu from '@/components/AuthMenu';
import Leaderboard from '@/components/Leaderboard';
import GlobeMark from '@/components/GlobeMark';
import { formatThousands, parseDigits } from '@/lib/format';
import { BOARD_POPULATIONS, formatPopulation } from '@/lib/boards';
import { api } from '@/lib/basePath';

export default function Home() {
  const router = useRouter();
  // Raw digits in state, separators only on the way to the input -- see
  // lib/format.ts for why this can't be an <input type="number">.
  const [population, setPopulation] = useState('100000');
  const [onlyCoast, setOnlyCoast] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startGame(targetPopulation: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api('/api/game/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPopulation, onlyCoast }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'failed to start game');
      const data = await res.json();
      router.push(`/play/${data.gameId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong');
      setLoading(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 pb-16 pt-5">
      <header className="flex w-full items-center justify-between">
        {/* Plain <a>, not next/link: basePath rewrites <Link href="/"> to
            "/guesswhere", which is this very page. Leaving the app entirely is
            exactly what this button is for. */}
        <a href="/" className="gw-btn px-3 py-1.5 text-sm">
          <span aria-hidden="true">←</span> All games
        </a>
        <AuthMenu />
      </header>

      {/* Two columns from lg up, stacked below. The split isn't decorative:
          stacked, the hero pushed the start button under the fold on a
          1280x720 laptop, which is the worst thing a landing page can do to
          its primary action. */}
      <div className="mt-10 grid flex-1 items-center gap-10 lg:mt-0 lg:grid-cols-[1fr_400px] lg:gap-16">
        {/* -------------------------------------------------------------- hero */}
        {/* min-w-0: a grid item defaults to min-width:auto, so one unbreakable
            child can push its own track wider than the viewport. "Guesswhere"
            is a single word at display size and did exactly that. */}
        <section className="gw-rise flex min-w-0 flex-col items-start">
          <GlobeMark size={64} />
          {/* "v2" as an edition mark rather than part of the word: mono, small
              caps-height, set on the baseline beside the display serif -- the
              way a printed atlas numbers a revision. Making it a second element
              also keeps the wrap behaviour the comment above describes, since
              it can break away from "Guesswhere" instead of widening it. */}
          <h1 className="gw-display mt-5 flex flex-wrap items-baseline gap-x-3 text-[3.25rem] leading-[0.95] sm:text-7xl">
            Guesswhere
            {/* The digit is sized to match the x-height of the display serif's
                final "e", so "2" and "e" read as the same height on the shared
                baseline. Not a round number: IBM Plex Mono's digits are 0.72em
                tall and Fraunces' x-height is 0.486em, so the digit needs
                0.486/0.72 of the heading size. Measured off the real fonts with
                canvas TextMetrics -- both values change if either family does.
                The "v" stays small, so it reads as a version mark rather than
                as part of the word. */}
            <span className="gw-num text-gw-verdigris">
              <span className="text-[0.42em] tracking-[0.04em]">v</span>
              <span className="text-[0.673em]">2</span>
            </span>
          </h1>
          <p className="gw-eyebrow mt-4">Ten cities · Imagery only</p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-gw-mute">
            You get a satellite view and nothing else. No labels, no roads with names, no
            pins — just the ground. Name the city.
          </p>

          <div className="mt-8 flex flex-wrap gap-6">
            <DuelLink href="/duel/new" title="Create a duel" hint="Host a lobby, get a code" />
            <DuelLink href="/duel/join" title="Join a duel" hint="Enter a 4-letter code" />
          </div>
        </section>

        {/* ----------------------------------------------------------- console */}
        {/* One panel, and nothing nested inside it -- the sections are told
            apart by rules and space, which is what a printed page would do. */}
        <section
          className="gw-rise gw-panel w-full min-w-0 p-6"
          style={{ animationDelay: '0.08s' }}
        >
          <div className="flex items-baseline justify-between">
            <h2 className="gw-eyebrow">Minimum population</h2>
            <span className="gw-eyebrow text-gw-verdigris">
              {onlyCoast ? 'Coastal' : 'Global'}
            </span>
          </div>

          <input
            type="text"
            inputMode="numeric"
            aria-label="Minimum population"
            value={formatThousands(population)}
            onChange={(e) => setPopulation(parseDigits(e.target.value))}
            className="gw-input gw-num mt-3 w-full px-4 py-2.5 text-center text-2xl"
          />

          <div className="mt-2.5 flex gap-1.5">
            {BOARD_POPULATIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPopulation(String(p))}
                data-active={population === String(p)}
                className="gw-chip gw-num flex-1 py-1 text-xs"
              >
                {formatPopulation(p)}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-gw-faint">
            A floor, not a target — every city is at least this big, with no upper limit.
          </p>

          <hr className="gw-rule my-5" />

          {/* Two radio-ish rows rather than a boxed segmented control. These
              are the two leaderboards, so they deserve to read as a real
              choice, but not as another card inside this one. */}
          <h2 className="gw-eyebrow">City pool</h2>
          <div className="mt-2 flex flex-col">
            {[
              { value: false, label: 'All cities', hint: 'Anywhere on Earth' },
              { value: true, label: 'Coast only', hint: 'Within 20 miles of ocean' },
            ].map((opt) => {
              const active = onlyCoast === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  onClick={() => setOnlyCoast(opt.value)}
                  className="flex items-center gap-3 py-2 text-left"
                >
                  <span
                    className={`grid h-3.5 w-3.5 shrink-0 place-content-center rounded-full border ${
                      active ? 'border-gw-verdigris' : 'border-gw-ink/25'
                    }`}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-gw-verdigris" />}
                  </span>
                  <span className={`text-sm ${active ? 'text-gw-ink' : 'text-gw-mute'}`}>
                    {opt.label}
                  </span>
                  <span className="ml-auto text-xs text-gw-faint">{opt.hint}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => startGame(Number(population))}
            disabled={loading || !Number(population)}
            className="gw-cta mt-6 w-full px-8 py-3 text-[15px]"
          >
            {loading ? 'Finding cities…' : 'Start game'}
          </button>

          {error && (
            <p className="mt-3 border-l-2 border-gw-vermilion py-1 pl-3 text-sm text-gw-vermilion">
              {error}
            </p>
          )}
        </section>
      </div>

      <section className="gw-rise mt-14 w-full" style={{ animationDelay: '0.16s' }}>
        <Leaderboard />
      </section>

      <div className="mt-12 max-w-lg space-y-2 text-xs leading-relaxed text-gw-faint">
        <p>
          Every answer is read out of the same map data the minimap draws — if a city has no
          label on the map, it is not in the game.
        </p>
        {/* The homage the "v2" refers to. Credit, not comparison: the idea is
            theirs, and naming it plainly is the point of the rename. */}
        <p>
          A second take on{' '}
          <a
            href="https://guesswhere.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gw-mute underline decoration-gw-faint underline-offset-2 hover:text-gw-ink"
          >
            the original GuessWhere
          </a>
          , which is where the idea came from.
        </p>
      </div>
    </main>
  );
}

/** Deliberately a link with a rule under it, not a card. Two cards here meant
 * cards inside a page of cards, and these are secondary actions. */
function DuelLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link href={href} className="group">
      <span className="block border-b border-gw-ink/20 pb-1 text-[15px] font-medium text-gw-ink transition group-hover:border-gw-verdigris group-hover:text-gw-verdigris">
        {title} <span aria-hidden="true">→</span>
      </span>
      <span className="mt-1 block text-xs text-gw-faint">{hint}</span>
    </Link>
  );
}
