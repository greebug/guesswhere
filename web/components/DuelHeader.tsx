'use client';

import Link from 'next/link';
import { colorForPlayer } from '@/lib/playerColors';

interface DuelPlayer {
  id: string;
  name: string;
  roundWins: number;
}

interface DuelHeaderProps {
  players: DuelPlayer[];
  targetRounds: number;
  selfPlayerId: string | null;
  remainingSeconds: number | null;
  onRecenter: () => void;
  onReport: () => void;
  /** Player ids who've reported the current round -- skips it once everyone
   * has, see duelLogic.ts's reportRound(). */
  reportedBy: string[];
  totalPlayers: number;
  /** True while the client is holding the just-ended round on screen during
   * the result pause -- the server may already be on a newer round by then,
   * so reporting would silently target the wrong one. */
  reportDisabled: boolean;
}

const TIMER_CRITICAL_S = 10;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** One player's score, in their own color -- the same color their rounds get
 * on the post-match map, so the scoreboard and the report read as one thing. */
function ScoreChip({
  player,
  players,
  targetRounds,
  isSelf,
}: {
  player: DuelPlayer;
  players: DuelPlayer[];
  targetRounds: number;
  isSelf: boolean;
}) {
  const color = colorForPlayer(players, player.id);
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-2.5 py-1"
      style={{
        borderColor: `${color}55`,
        background: `${color}14`,
        boxShadow: isSelf ? `0 0 20px -6px ${color}` : undefined,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span
        className={`max-w-28 truncate text-sm ${isSelf ? 'font-bold' : 'font-medium'}`}
        style={{ color }}
      >
        {player.name}
      </span>
      <span className="gw-num text-sm font-bold" style={{ color }}>
        {player.roundWins}
        <span className="text-[10px] opacity-50">/{targetRounds}</span>
      </span>
    </div>
  );
}

export default function DuelHeader({
  players,
  targetRounds,
  selfPlayerId,
  remainingSeconds,
  onRecenter,
  onReport,
  reportedBy,
  totalPlayers,
  reportDisabled,
}: DuelHeaderProps) {
  const critical = remainingSeconds !== null && remainingSeconds <= TIMER_CRITICAL_S;
  const hasReported = !!selfPlayerId && reportedBy.includes(selfPlayerId);

  return (
    <div className="relative z-30 flex items-center justify-between gap-4 border-b border-gw-ink/10 bg-gradient-to-b from-black/90 to-black/70 px-3 py-2 text-gw-ink">
      <Link href="/" className="gw-btn px-3 py-1.5 text-sm">
        Home
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {players.map((p) => (
            <ScoreChip
              key={p.id}
              player={p}
              players={players}
              targetRounds={targetRounds}
              isSelf={p.id === selfPlayerId}
            />
          ))}
        </div>

        {remainingSeconds !== null && (
          <div className="flex flex-col items-end leading-none">
            <span className="gw-eyebrow text-[9px]">Remaining</span>
            <span
              className={`gw-num rounded px-1 text-lg font-bold ${
                critical ? 'animate-timer-critical bg-gw-vermilion text-white' : 'text-gw-ink'
              }`}
              style={critical ? undefined : { textShadow: '0 0 18px rgb(76 201 255 / 0.6)' }}
            >
              {formatTime(Math.max(0, remainingSeconds))}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRecenter}
          title="Snap back to the pinpointed view of this round's city"
          className="gw-btn gw-tone-indigo px-3 py-1.5 text-sm"
        >
          🎯 Recenter
        </button>
        <button
          onClick={onReport}
          disabled={hasReported || reportDisabled}
          title="Bad or unusable imagery (e.g. heavy cloud cover) -- skips this round once every player has reported it, and excludes the city from all future games"
          className="gw-btn gw-tone-vermilion px-3 py-1.5 text-sm"
        >
          {hasReported ? `🚩 Reported (${reportedBy.length}/${totalPlayers})` : '🚩 Report Round'}
        </button>
      </div>
    </div>
  );
}
