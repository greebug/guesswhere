'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthMenu from '@/components/AuthMenu';
import Leaderboard from '@/components/Leaderboard';
import OrbitMark from '@/components/OrbitMark';
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
    <main className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-16 pt-5">
      <header className="flex w-full items-center justify-between">
        {/* Plain <a>, not next/link: basePath rewrites <Link href="/"> to
            "/guesswhere", which is this very page. Leaving the app entirely is
            exactly what this button is for. */}
        <a
          href="/"
          className="gw-btn px-3 py-1.5 text-sm text-gw-mute hover:text-gw-ink"
        >
          <span aria-hidden="true">←</span> All games
        </a>
        <AuthMenu />
      </header>

      {/* Two columns from lg up, stacked below. The split isn't decorative:
          stacked, the hero pushed the Launch button under the fold on a
          1280x720 laptop, which is the single worst thing a landing page can
          do to its primary action. */}
      <div className="mt-8 grid flex-1 items-center gap-8 lg:mt-0 lg:grid-cols-[1.05fr_minmax(360px,0.95fr)] lg:gap-12">
        {/* -------------------------------------------------------------- hero */}
        {/* min-w-0: a grid item defaults to min-width:auto, so one unbreakable
            child can push its own track wider than the viewport. "GUESSWHERE"
            is a single 10-character word with letter-spacing on it and did
            exactly that -- 45px of horizontal scroll at 375px wide, which is
            also why the type scale starts small and steps up rather than
            starting at the desktop size. */}
        <section className="gw-rise flex min-w-0 flex-col items-center text-center lg:items-start lg:text-left">
          <OrbitMark size={116} />
          <h1 className="gw-display mt-5 text-[2rem] font-black tracking-[0.08em] sm:text-5xl sm:tracking-[0.12em] lg:text-6xl">
            GUESSWHERE
          </h1>
          <div className="mt-3 flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-transparent to-gw-teal/60 lg:hidden" />
            <p className="gw-eyebrow text-gw-mute">Ten cities · Imagery only</p>
            <span className="h-px w-8 bg-gradient-to-l from-transparent to-gw-teal/60" />
          </div>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-gw-mute">
            You get a satellite view and nothing else. No labels, no roads with names, no
            pins — just the ground. Name the city.
          </p>

          <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-3">
            <DuelCard
              href="/duel/new"
              tone="violet"
              icon="⚔"
              title="Create a Duel"
              hint="Host a lobby, get a code"
            />
            <DuelCard
              href="/duel/join"
              tone="cyan"
              icon="⚡"
              title="Join a Duel"
              hint="Enter a 4-letter code"
            />
          </div>
        </section>

        {/* ----------------------------------------------------------- console */}
        <section
          className="gw-rise gw-panel gw-panel-lit w-full min-w-0 justify-self-center p-6 lg:max-w-none"
          style={{ ['--gw-tone' as string]: '46 230 197', animationDelay: '0.1s' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="gw-eyebrow">Minimum population</h2>
            <span className="gw-num text-[11px] text-gw-faint">
              {onlyCoast ? 'COASTAL' : 'GLOBAL'}
            </span>
          </div>

          <input
            type="text"
            inputMode="numeric"
            aria-label="Minimum population"
            value={formatThousands(population)}
            onChange={(e) => setPopulation(parseDigits(e.target.value))}
            className="gw-input gw-num mt-3 w-full px-4 py-3 text-center text-3xl font-semibold text-gw-teal"
          />
          <p className="mt-2 text-center text-[11px] leading-relaxed text-gw-faint">
            A floor, not a target — every city is at least this big, with no upper limit.
          </p>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {BOARD_POPULATIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPopulation(String(p))}
                data-active={population === String(p)}
                className="gw-chip gw-num px-2 py-1.5 text-xs"
              >
                {formatPopulation(p)}
              </button>
            ))}
          </div>

          <hr className="gw-rule my-5" />

          {/* A two-state segmented control rather than a checkbox: these are the
              two leaderboards, so they deserve to look like a choice between
              two modes instead of an afterthought toggle. */}
          <h2 className="gw-eyebrow">City pool</h2>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
            {[
              { value: false, label: 'All cities', hint: 'Anywhere on Earth' },
              { value: true, label: 'Coast only', hint: 'Within 20mi of ocean' },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setOnlyCoast(opt.value)}
                className={`rounded-lg px-3 py-2 text-left transition ${
                  onlyCoast === opt.value
                    ? 'bg-gw-teal/15 shadow-[0_0_24px_-10px_rgb(46,230,197,0.9)] ring-1 ring-gw-teal/40'
                    : 'hover:bg-white/5'
                }`}
              >
                <span
                  className={`block text-sm font-semibold ${
                    onlyCoast === opt.value ? 'text-gw-teal' : 'text-gw-mute'
                  }`}
                >
                  {opt.label}
                </span>
                <span className="block text-[10px] text-gw-faint">{opt.hint}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => startGame(Number(population))}
            disabled={loading || !Number(population)}
            className="gw-cta mt-6 w-full px-8 py-3.5 text-base"
          >
            {loading ? 'Plotting orbit…' : 'Launch'}
          </button>

          {error && (
            <p className="mt-3 rounded-lg border border-gw-rose/30 bg-gw-rose/10 px-3 py-2 text-center text-sm text-gw-rose">
              {error}
            </p>
          )}
        </section>
      </div>

      <section
        className="gw-rise mx-auto mt-12 w-full max-w-2xl"
        style={{ animationDelay: '0.3s' }}
      >
        <Leaderboard />
      </section>

      <p className="mx-auto mt-10 max-w-md text-center text-[11px] leading-relaxed text-gw-faint">
        Every answer is read out of the same map data the minimap draws — if a city has no
        label on the map, it is not in the game.
      </p>
    </main>
  );
}

function DuelCard({
  href,
  tone,
  icon,
  title,
  hint,
}: {
  href: string;
  tone: 'violet' | 'cyan';
  icon: string;
  title: string;
  hint: string;
}) {
  const toneRgb = tone === 'violet' ? '157 123 255' : '76 201 255';
  return (
    <Link
      href={href}
      className="gw-panel group flex flex-col gap-1 p-4 transition hover:-translate-y-0.5"
      style={{ ['--gw-tone' as string]: toneRgb }}
    >
      <span
        className="text-lg transition group-hover:scale-110"
        style={{ color: `rgb(${toneRgb})` }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-gw-ink">{title}</span>
      <span className="text-[11px] text-gw-faint">{hint}</span>
      <span
        className="mt-1 h-px w-0 transition-all duration-300 group-hover:w-full"
        style={{ background: `linear-gradient(90deg, rgb(${toneRgb}), transparent)` }}
      />
    </Link>
  );
}
