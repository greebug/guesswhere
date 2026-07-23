'use client';

import { useEffect, useRef, useState } from 'react';
import MainMap, { type MainMapHandle } from '@/components/MainMap';
import MiniMap from '@/components/MiniMap';
import DuelHeader from '@/components/DuelHeader';
import AnswerBox from '@/components/AnswerBox';
import RoundResultOverlay from '@/components/RoundResultOverlay';
import DuelReport, { type DuelReportRound } from '@/components/DuelReport';

interface DuelPlayer {
  id: string;
  name: string;
  roundWins: number;
}

interface DuelSettings {
  timerSeconds: number;
  targetRounds: number;
  targetPopulation: number;
  onlyCoast: boolean;
}

interface CurrentRound {
  index: number;
  lat: number;
  lon: number;
  minRenderZoom: number;
  reportedBy: string[];
}

interface LastRound {
  index: number;
  solvedByPlayerId: string | null;
  timedOut: boolean;
  canonicalName: string | null;
}

interface DuelState {
  lobbyId: string;
  joinCode: string;
  hostPlayerId: string;
  status: 'lobby' | 'countdown' | 'playing' | 'finished';
  players: DuelPlayer[];
  settings: DuelSettings;
  countdownEndsAt: number | null;
  roundDeadlineAt: number | null;
  roundSeq: number;
  currentRound: CurrentRound | null;
  lastRound: LastRound | null;
  rounds: DuelReportRound[] | null;
  winnerId: string | null;
}

const ROUND_RESULT_PAUSE_MS = 2000;
const POLL_MS = 750;

function playerIdKey(lobbyId: string) {
  return `duel:${lobbyId}:playerId`;
}

export default function DuelClient({ lobbyId }: { lobbyId: string }) {
  const [state, setState] = useState<DuelState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [displayedRoundSeq, setDisplayedRoundSeq] = useState<number | null>(null);
  const [displayedRound, setDisplayedRound] = useState<CurrentRound | null>(null);
  const [transitionInfo, setTransitionInfo] = useState<LastRound | null>(null);
  // Wall-clock start of the current pause, not a setTimeout handle -- see the
  // effect below for why.
  const transitionStartRef = useRef<number | null>(null);

  const mainMapRef = useRef<MainMapHandle>(null);

  useEffect(() => {
    const cached = localStorage.getItem(playerIdKey(lobbyId));
    if (cached) setPlayerId(cached);
  }, [lobbyId]);

  // Poll server state throughout the lobby's lifetime -- see PLAN.md: the
  // server is the sole timing authority, this is just how clients observe it.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/duel/${lobbyId}/state`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) setNotFound(true);
          return;
        }
        const data = await res.json();
        setState(data.state);
      } catch {
        // transient network blip -- next tick tries again
      }
    }
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [lobbyId]);

  // Local ~5x/sec tick purely to re-render the live countdown/timer display
  // between polls -- the server's deadline timestamps are the actual truth.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);

  // Adopt the first live round immediately (no transition pause -- there's
  // no "previous" round to hold on screen); on later round changes, hold the
  // just-completed round under the result overlay for a beat before
  // switching. Deliberately keyed on `displayedRound`, not `roundSeq` --
  // starting a match doesn't bump roundSeq (only advancing BETWEEN rounds
  // does), so a `roundSeq`-only check never notices the lobby/countdown ->
  // playing transition for round 0, leaving the map stuck unmounted for the
  // whole first round.
  //
  // The pause itself is driven by a wall-clock comparison re-checked on every
  // poll tick, not a one-shot setTimeout -- a dropped/delayed timer (e.g. a
  // backgrounded tab throttling JS timers) used to leave the round genuinely
  // stuck forever with no retry, requiring a manual reload. Every poll now
  // re-evaluates "has the pause elapsed?", so it self-heals the moment
  // polling resumes, the same way every other piece of duel state here does.
  useEffect(() => {
    if (!state) return;
    if (displayedRound === null) {
      if (state.currentRound) {
        setDisplayedRoundSeq(state.roundSeq);
        setDisplayedRound(state.currentRound);
      }
      return;
    }
    if (state.roundSeq === displayedRoundSeq) return;
    if (transitionStartRef.current === null) {
      transitionStartRef.current = Date.now();
      setTransitionInfo(state.lastRound);
      return;
    }
    if (Date.now() - transitionStartRef.current >= ROUND_RESULT_PAUSE_MS) {
      setDisplayedRoundSeq(state.roundSeq);
      setDisplayedRound(state.currentRound);
      setTransitionInfo(null);
      transitionStartRef.current = null;
    }
  }, [state, displayedRoundSeq, displayedRound]);

  async function handleJoin(name: string) {
    const res = await fetch(`/api/duel/${lobbyId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'failed to join');
    const data = await res.json();
    localStorage.setItem(playerIdKey(lobbyId), data.playerId);
    setPlayerId(data.playerId);
    setState(data.state);
  }

  async function handleSettingsChange(settings: DuelSettings) {
    if (!playerId) return;
    const res = await fetch(`/api/duel/${lobbyId}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, ...settings }),
    });
    if (res.ok) setState((await res.json()).state);
  }

  async function handleStart() {
    if (!playerId) return;
    const res = await fetch(`/api/duel/${lobbyId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (res.ok) setState((await res.json()).state);
  }

  async function handleGuess(guess: string): Promise<{ correct: boolean; canonicalName: string | null }> {
    if (!playerId) return { correct: false, canonicalName: null };
    const res = await fetch(`/api/duel/${lobbyId}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, guess }),
    });
    const data = await res.json();
    setState(data.state);
    return { correct: !!data.correct, canonicalName: data.canonicalName ?? null };
  }

  async function handleReport() {
    if (!playerId) return;
    const res = await fetch(`/api/duel/${lobbyId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    if (res.ok) setState((await res.json()).state);
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
        <p>Lobby not found.</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
        <p>Loading...</p>
      </div>
    );
  }

  const isJoined = !!playerId && state.players.some((p) => p.id === playerId);
  const isHost = !!playerId && playerId === state.hostPlayerId;

  if (!isJoined) {
    return <JoinScreen onJoin={handleJoin} />;
  }

  if (state.status === 'lobby') {
    return (
      <LobbyScreen
        state={state}
        isHost={isHost}
        onSettingsChange={handleSettingsChange}
        onStart={handleStart}
      />
    );
  }

  if (state.status === 'countdown') {
    const remaining = state.countdownEndsAt ? Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000)) : 0;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-900 text-white">
        <p className="text-2xl text-zinc-400">Get ready...</p>
        <p className="text-9xl font-extrabold tabular-nums">{remaining > 0 ? remaining : 'GO'}</p>
      </div>
    );
  }

  // Finished: replace the whole screen with the match report (map of every
  // round colored by whoever won it + a round list), same pattern as the
  // solo GameReport -- rather than layering a winner card on top of the
  // last round's map, which is what the old WinnerOverlay did.
  if (state.status === 'finished' && state.winnerId && state.rounds) {
    return <DuelReport players={state.players} winnerId={state.winnerId} rounds={state.rounds} />;
  }

  const remainingSeconds = state.roundDeadlineAt ? Math.ceil((state.roundDeadlineAt - now) / 1000) : null;
  const settled = transitionInfo !== null;

  return (
    <div className="flex h-screen flex-col overflow-hidden overscroll-none bg-black">
      <DuelHeader
        players={state.players}
        targetRounds={state.settings.targetRounds}
        selfPlayerId={playerId}
        remainingSeconds={state.status === 'playing' ? remainingSeconds : null}
        onRecenter={() => mainMapRef.current?.recenterPinpoint()}
        onReport={handleReport}
        reportedBy={state.currentRound?.reportedBy ?? []}
        totalPlayers={state.players.length}
        reportDisabled={settled}
      />

      <div className="relative flex-1">
        {displayedRound && (
          <>
            <MainMap ref={mainMapRef} lat={displayedRound.lat} lon={displayedRound.lon} roundKey={displayedRound.index} />
            <MiniMap
              lat={displayedRound.lat}
              lon={displayedRound.lon}
              roundKey={displayedRound.index}
              showAnswer={settled}
            />
          </>
        )}

        {settled && transitionInfo && (
          <RoundResultOverlay
            solvedByName={
              transitionInfo.solvedByPlayerId
                ? state.players.find((p) => p.id === transitionInfo.solvedByPlayerId)?.name ?? null
                : null
            }
            canonicalName={transitionInfo.canonicalName}
          />
        )}

        {displayedRound && (
          <div className="absolute bottom-6 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 px-4">
            <AnswerBox
              resetKey={`${displayedRound.index}:${displayedRound.lat}:${displayedRound.lon}`}
              solved={settled ? !!transitionInfo?.solvedByPlayerId : false}
              revealed={settled ? !!transitionInfo?.timedOut : false}
              canonicalName={settled ? transitionInfo?.canonicalName ?? null : null}
              onGuess={handleGuess}
              onPrev={() => {}}
              onNext={() => {}}
              canPrev={false}
              canNext={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function JoinScreen({ onJoin }: { onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onJoin(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to join');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-900 px-4 text-white">
      <h1 className="text-3xl font-bold">Join Duel</h1>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        maxLength={40}
        placeholder="Your name"
        autoFocus
        className="w-64 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-lg"
      />
      <button
        onClick={submit}
        disabled={loading || !name.trim()}
        className="rounded-full bg-white px-8 py-3 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
      >
        {loading ? 'Joining...' : 'Ready'}
      </button>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

function LobbyScreen({
  state,
  isHost,
  onSettingsChange,
  onStart,
}: {
  state: DuelState;
  isHost: boolean;
  onSettingsChange: (settings: DuelSettings) => void;
  onStart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [local, setLocal] = useState<DuelSettings>(state.settings);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      setLocal(state.settings);
      initialized.current = true;
    }
  }, [state.settings]);

  function change(next: Partial<DuelSettings>) {
    const merged = { ...local, ...next };
    setLocal(merged);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSettingsChange(merged), 300);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(state.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const settings = isHost ? local : state.settings;
  const m = Math.floor(settings.timerSeconds / 60);
  const s = settings.timerSeconds % 60;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-900 px-4 py-8 text-white">
      <h1 className="text-4xl font-bold">Duel Lobby</h1>

      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-zinc-400">
          Give friends this code on the <span className="underline">Join a Duel</span> page
        </p>
        <button
          onClick={copyCode}
          title="Click to copy"
          className="rounded-lg bg-zinc-700 px-6 py-3 text-4xl font-bold tracking-[0.3em] hover:bg-zinc-600"
        >
          {copied ? 'Copied!' : state.joinCode}
        </button>
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-zinc-400">Players</p>
        <div className="flex flex-wrap justify-center gap-2">
          {state.players.map((p) => (
            <span key={p.id} className="rounded bg-zinc-800 px-3 py-1">
              {p.name} {p.id === state.hostPlayerId && '(host)'}
            </span>
          ))}
        </div>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">
            Round timer: {m}:{String(s).padStart(2, '0')}
          </label>
          <input
            type="range"
            min={30}
            max={600}
            step={15}
            value={settings.timerSeconds}
            disabled={!isHost}
            onChange={(e) => change({ timerSeconds: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">
            First to {settings.targetRounds} round{settings.targetRounds === 1 ? '' : 's'} wins
          </label>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={settings.targetRounds}
            disabled={!isHost}
            onChange={(e) => change({ targetRounds: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col items-center gap-2">
          <label className="text-sm text-zinc-400">Population Threshold</label>
          <input
            type="number"
            min={1}
            value={settings.targetPopulation}
            disabled={!isHost}
            onChange={(e) => change({ targetPopulation: Number(e.target.value) })}
            className="w-48 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-center text-lg disabled:opacity-60"
          />
        </div>
        <label className="flex items-center justify-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={settings.onlyCoast}
            disabled={!isHost}
            onChange={(e) => change({ onlyCoast: e.target.checked })}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
          />
          Only Coast (within 20mi of a coastline)
        </label>
      </div>

      {isHost ? (
        <button
          onClick={onStart}
          className="rounded-full bg-white px-8 py-3 font-semibold text-black hover:bg-zinc-200"
        >
          Start Game
        </button>
      ) : (
        <p className="text-zinc-400">Waiting for the host to start...</p>
      )}
    </div>
  );
}
