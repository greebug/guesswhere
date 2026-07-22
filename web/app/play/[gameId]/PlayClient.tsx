'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MainMap, { type MainMapHandle } from '@/components/MainMap';
import MiniMap from '@/components/MiniMap';
import GameHeader from '@/components/GameHeader';
import AnswerBox from '@/components/AnswerBox';
import GameReport, { type GameSummary } from '@/components/GameReport';

interface RoundView {
  index: number;
  lat: number;
  lon: number;
  minRenderZoom: number;
  solved: boolean;
  revealed: boolean;
  canonicalName: string | null;
}

interface GameView {
  gameId: string;
  targetPopulation: number;
  correctCount: number;
  elapsedMs: number;
  complete: boolean;
  rounds: RoundView[];
}

// Beats often enough that the server's 30s single-step cap never binds during
// real play, but rarely enough to be invisible on the network tab. See
// MAX_ACCRUAL_STEP_MS in lib/server/gameLogic.ts.
const HEARTBEAT_MS = 10_000;

export default function PlayClient({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reportPending, setReportPending] = useState(false);
  const [summary, setSummary] = useState<GameSummary | null>(null);
  // Total banked on the server, plus a local ticker so the header clock moves
  // between heartbeats rather than jumping every 10 seconds.
  const [bankedMs, setBankedMs] = useState(0);
  const [tickBase, setTickBase] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const mainMapRef = useRef<MainMapHandle>(null);

  // Declared before the mount effect below, which calls it -- it resolves at
  // runtime either way (the .then runs after the component body finishes) but
  // relying on that is a temporal-dead-zone trap waiting to bite.
  const loadSummary = useCallback(async () => {
    const res = await fetch(`/api/game/${gameId}/summary`);
    if (!res.ok) return;
    setSummary(await res.json());
  }, [gameId]);

  useEffect(() => {
    fetch(`/api/game/${gameId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'game not found');
        return res.json();
      })
      .then((g: GameView) => {
        setGame(g);
        setBankedMs(g.elapsedMs);
        setTickBase(Date.now());
        // Resuming a game that's already over: go straight to the report.
        if (g.complete) loadSummary();
        else {
          // Start on the first unsettled round rather than always round 0 --
          // reloading mid-game shouldn't drop you back at the beginning.
          const next = g.rounds.findIndex((r) => !r.solved && !r.revealed);
          if (next > 0) setCurrentIndex(next);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load game'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Tell the server which slide is on screen. Doubles as the heartbeat: the
  // same call with an unchanged index just banks the interval so far.
  const focus = useCallback(
    async (roundIndex: number) => {
      try {
        const res = await fetch(`/api/game/${gameId}/focus`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roundIndex }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setBankedMs(data.elapsedMs);
        setTickBase(Date.now());
      } catch {
        // A dropped heartbeat is self-correcting -- the next one banks the
        // interval, bounded by the server's per-step cap.
      }
    },
    [gameId]
  );

  useEffect(() => {
    if (!game || game.complete || summary) return;
    focus(currentIndex);
    const interval = setInterval(() => focus(currentIndex), HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [game, currentIndex, focus, summary]);

  // Local ticker for the header clock only; the server remains the authority.
  useEffect(() => {
    if (summary) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [summary]);

  async function handleGuess(guess: string) {
    const res = await fetch(`/api/game/${gameId}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roundIndex: currentIndex, guess }),
    });
    const data = await res.json();
    setGame((g) => {
      if (!g) return g;
      const rounds = g.rounds.map((r) =>
        r.index === currentIndex
          ? { ...r, solved: data.correct || r.solved, canonicalName: data.canonicalName ?? r.canonicalName }
          : r
      );
      return { ...g, rounds, correctCount: data.correctCount, complete: data.complete };
    });
    if (data.complete) loadSummary();
    return { correct: data.correct as boolean, canonicalName: data.canonicalName as string | null };
  }

  async function handleReveal() {
    const res = await fetch(`/api/game/${gameId}/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roundIndex: currentIndex }),
    });
    const data = await res.json();
    setGame((g) => {
      if (!g) return g;
      const rounds = g.rounds.map((r) =>
        r.index === currentIndex ? { ...r, revealed: true, canonicalName: data.canonicalName } : r
      );
      return { ...g, rounds, complete: data.complete };
    });
    if (data.complete) loadSummary();
  }

  async function handleReport() {
    if (reportPending) return;
    setReportPending(true);
    try {
      const res = await fetch(`/api/game/${gameId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundIndex: currentIndex }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setGame((g) => {
        if (!g) return g;
        const rounds = g.rounds.map((r) => (r.index === currentIndex ? { ...r, ...data.round } : r));
        return { ...g, rounds };
      });
    } finally {
      setReportPending(false);
    }
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
        <p>{error}</p>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
        <p>Loading...</p>
      </div>
    );
  }

  // Finished: replace the whole screen with the report (map of all 10 cities
  // + time breakdown), matching the leaderboard result page rather than
  // overlaying it on top of the last round's map.
  if (summary) {
    return <GameReport summary={summary} />;
  }

  const round = game.rounds[currentIndex];
  // Only an unsettled round is still accruing, so a solved one's clock stops
  // moving on screen exactly as it does on the server.
  const liveMs = round.solved || round.revealed ? bankedMs : bankedMs + (now - tickBase);

  return (
    <div className="flex h-screen flex-col bg-black">
      <GameHeader
        gameId={gameId}
        onRecenter={() => mainMapRef.current?.recenterPinpoint()}
        onReveal={handleReveal}
        revealDisabled={round.solved || round.revealed}
        onReport={handleReport}
        reportPending={reportPending}
        correctCount={game.correctCount}
        totalRounds={game.rounds.length}
        currentSlide={currentIndex + 1}
        elapsedMs={liveMs}
      />

      <div className="relative flex-1">
        <MainMap ref={mainMapRef} lat={round.lat} lon={round.lon} roundKey={round.index} />

        <MiniMap lat={round.lat} lon={round.lon} roundKey={round.index} showAnswer={round.revealed} />

        <div className="absolute bottom-6 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 px-4">
          <AnswerBox
            resetKey={`${round.index}:${round.lat}:${round.lon}`}
            solved={round.solved}
            revealed={round.revealed}
            canonicalName={round.canonicalName}
            onGuess={handleGuess}
            onPrev={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            onNext={() => setCurrentIndex((i) => Math.min(game.rounds.length - 1, i + 1))}
            canPrev={currentIndex > 0}
            canNext={currentIndex < game.rounds.length - 1}
          />
        </div>
      </div>
    </div>
  );
}
