'use client';

interface RoundResultOverlayProps {
  solvedByName: string | null; // null => timed out, nobody solved it
  canonicalName: string | null;
}

export default function RoundResultOverlay({ solvedByName, canonicalName }: RoundResultOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="animate-round-result rounded-2xl bg-white px-10 py-6 text-center shadow-2xl">
        <p className="text-3xl font-bold text-zinc-900">
          {solvedByName ? `${solvedByName} got it!` : "Time's up!"}
        </p>
        {canonicalName && <p className="mt-1 text-lg text-zinc-500">{canonicalName}</p>}
      </div>
    </div>
  );
}
