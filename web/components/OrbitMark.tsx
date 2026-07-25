/**
 * The Guesswhere mark: a wireframe globe inside three tilted rings that turn
 * at different speeds, each carrying a satellite.
 *
 * The gyroscope look comes from a deliberate cheat. Sending a dot around an
 * ELLIPSE needs either SMIL or CSS `offset-path`, so instead each dot is a
 * sibling of its ring inside the same rotating group -- the dot never moves
 * relative to its ring, the ring itself turns, and to the eye the satellite
 * sweeps around the tilted orbit. It's one CSS rotation per group, it honors
 * prefers-reduced-motion for free (see globals.css), and it looks better than
 * the literal version.
 */
export default function OrbitMark({ size = 128 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      className="overflow-visible"
    >
      <defs>
        <radialGradient id="gw-globe" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#3ef0d0" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#1b7fd4" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#050b18" stopOpacity="0.9" />
        </radialGradient>
        <radialGradient id="gw-halo" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#2ee6c5" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2ee6c5" stopOpacity="0" />
        </radialGradient>
        {/* Latitude lines run past the globe's edge as drawn; this keeps them
            inside it so the sphere reads as solid. */}
        <clipPath id="gw-globe-clip">
          <circle cx="60" cy="60" r="27" />
        </clipPath>
      </defs>

      <circle cx="60" cy="60" r="52" fill="url(#gw-halo)" className="gw-pulse-soft" />

      {/* Globe body */}
      <circle cx="60" cy="60" r="27" fill="url(#gw-globe)" stroke="#2ee6c5" strokeOpacity="0.5" />
      <g clipPath="url(#gw-globe-clip)" stroke="#7fe9dc" strokeOpacity="0.35" strokeWidth="0.75">
        <ellipse cx="60" cy="60" rx="27" ry="9" />
        <ellipse cx="60" cy="60" rx="27" ry="19" />
        <ellipse cx="60" cy="60" rx="9" ry="27" />
        <ellipse cx="60" cy="60" rx="19" ry="27" />
        <line x1="33" y1="60" x2="87" y2="60" />
      </g>

      {/* Orbits. Each group turns as a unit -- ring plus its satellite. */}
      <g className="gw-spin-slow" style={{ transformOrigin: '60px 60px' }}>
        <g transform="rotate(-22 60 60)">
          <ellipse
            cx="60"
            cy="60"
            rx="52"
            ry="17"
            stroke="#4cc9ff"
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          <circle cx="112" cy="60" r="3.4" fill="#4cc9ff" />
          <circle cx="112" cy="60" r="6.5" fill="#4cc9ff" fillOpacity="0.22" />
        </g>
      </g>

      <g className="gw-spin-slower" style={{ transformOrigin: '60px 60px' }}>
        <g transform="rotate(58 60 60)">
          <ellipse
            cx="60"
            cy="60"
            rx="46"
            ry="14"
            stroke="#2ee6c5"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <circle cx="14" cy="60" r="2.8" fill="#2ee6c5" />
          <circle cx="14" cy="60" r="5.5" fill="#2ee6c5" fillOpacity="0.25" />
        </g>
      </g>

      <g className="gw-spin-slow" style={{ transformOrigin: '60px 60px', animationDirection: 'reverse' }}>
        <g transform="rotate(15 60 60)">
          <ellipse
            cx="60"
            cy="60"
            rx="39"
            ry="39"
            stroke="#9d7bff"
            strokeOpacity="0.28"
            strokeWidth="1"
            strokeDasharray="1 7"
          />
          <circle cx="99" cy="60" r="2.2" fill="#c4b1ff" />
        </g>
      </g>
    </svg>
  );
}
