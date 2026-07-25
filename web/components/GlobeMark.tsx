/**
 * The Guesswhere mark: a wireframe globe, drawn like an engraving.
 *
 * Replaced a three-ring orbiting-satellite version. The rings and glow were
 * doing the "space mission" thing far harder than the game wants -- this is
 * about looking at the ground, not leaving it. A globe on its own says
 * geography; the orbits said sci-fi.
 *
 * The one bit of motion left is the graticule turning behind a static
 * outline, which reads as the Earth rotating rather than as an animation.
 */
export default function GlobeMark({ size = 96 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      role="presentation"
    >
      <defs>
        {/* Keeps the turning meridians inside the sphere. */}
        <clipPath id="gw-globe-clip">
          <circle cx="50" cy="50" r="38" />
        </clipPath>
      </defs>

      <circle cx="50" cy="50" r="38" fill="#121b22" stroke="#4fb9a5" strokeWidth="1.25" />

      <g clipPath="url(#gw-globe-clip)">
        {/* Latitudes are fixed -- they don't move when a globe spins. */}
        <g stroke="#4fb9a5" strokeOpacity="0.3" strokeWidth="0.75" fill="none">
          <line x1="12" y1="50" x2="88" y2="50" />
          <ellipse cx="50" cy="50" rx="38" ry="13" />
          <ellipse cx="50" cy="50" rx="38" ry="26" />
        </g>

        {/* Meridians do. Squeezing the ellipse widths as the group turns is
            more trouble than it's worth at this size; a slow rotation of the
            whole set reads correctly and costs one transform. */}
        <g
          className="gw-spin-slow"
          style={{ transformOrigin: '50px 50px' }}
          stroke="#4fb9a5"
          strokeOpacity="0.22"
          strokeWidth="0.75"
          fill="none"
        >
          <ellipse cx="50" cy="50" rx="13" ry="38" />
          <ellipse cx="50" cy="50" rx="26" ry="38" />
          <line x1="50" y1="12" x2="50" y2="88" />
        </g>

        {/* A hint of landmass, so it isn't only a wire cage. Abstract on
            purpose -- a recognizable continent would imply the game is about
            that continent. */}
        <g fill="#4fb9a5" fillOpacity="0.16">
          <path d="M22 38c8-6 14-2 20 1s10 1 14-3 9-2 11 3-4 9-11 10-12 6-19 4-19-9-15-15Z" />
          <path d="M40 68c5-4 12-3 17 1s9 2 12-1c2 5-3 11-11 12s-19-6-18-12Z" />
        </g>
      </g>

      {/* Redrawn on top so the clipped edges stay crisp against the ground. */}
      <circle cx="50" cy="50" r="38" fill="none" stroke="#4fb9a5" strokeWidth="1.25" />
    </svg>
  );
}
