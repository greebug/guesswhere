'use client';

interface RoundResultOverlayProps {
  solvedByName: string | null; // null => timed out, nobody solved it
  canonicalName: string | null;
}

export default function RoundResultOverlay({ solvedByName, canonicalName }: RoundResultOverlayProps) {
  const won = !!solvedByName;
  // Same two-color language as everywhere else: teal for solved, amber for
  // a round that ran out of time.
  const tone = won ? '46 230 197' : '255 179 64';

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div
        className="animate-round-result gw-panel gw-panel-lit px-12 py-7 text-center"
        style={{ ['--gw-tone' as string]: tone }}
      >
        <p className="gw-eyebrow" style={{ color: `rgb(${tone})` }}>
          {won ? 'Round won' : 'Nobody got it'}
        </p>
        <p className="mt-1 text-3xl font-black text-gw-ink">
          {won ? `${solvedByName} got it!` : "Time's up!"}
        </p>
        {canonicalName && (
          <p className="mt-2 text-lg" style={{ color: `rgb(${tone})` }}>
            {canonicalName}
          </p>
        )}
      </div>
    </div>
  );
}
