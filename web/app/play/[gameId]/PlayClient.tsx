'use client';

import { useEffect, useRef, useState } from 'react';
import MainMap, { type MainMapHandle } from '@/components/MainMap';
import MiniMap from '@/components/MiniMap';
import GameHeader from '@/components/GameHeader';
import AnswerBox from '@/components/AnswerBox';

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
  rounds: RoundView[];
}

export default function PlayClient({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reportPending, setReportPending] = useState(false);
  const mainMapRef = useRef<MainMapHandle>(null);

  useEffect(() => {
    fetch(`/api/game/${gameId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'game not found');
        return res.json();
      })
      .then(setGame)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load game'));
  }, [gameId]);

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
      return { ...g, rounds, correctCount: data.correctCount };
    });
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
      return { ...g, rounds };
    });
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

  const round = game.rounds[currentIndex];

  return (
    <div className="flex h-screen flex-col bg-black">
      <GameHeader
        onRecenter={() => mainMapRef.current?.recenterPinpoint()}
        onReveal={handleReveal}
        revealDisabled={round.solved || round.revealed}
        onReport={handleReport}
        reportPending={reportPending}
        correctCount={game.correctCount}
        totalRounds={game.rounds.length}
        currentSlide={currentIndex + 1}
      />

      <div className="relative flex-1">
        <MainMap ref={mainMapRef} lat={round.lat} lon={round.lon} roundKey={round.index} />

        <MiniMap lat={round.lat} lon={round.lon} roundKey={round.index} />

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
