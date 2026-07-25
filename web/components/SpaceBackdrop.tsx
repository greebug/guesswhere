/**
 * The fixed, full-bleed backdrop every non-map screen sits on: a deep-space
 * field with two slowly drifting color clouds, a faint map graticule, and a
 * star layer.
 *
 * Entirely CSS and inline SVG on purpose -- a strict rule of this project is
 * that the only imagery ever fetched is Mapbox's (see CLAUDE.md's billing
 * invariants), and a decorative background has no business adding a network
 * request to any page's critical path.
 *
 * Not a client component: it renders identically every time, which is only
 * true because the star positions come from a seeded generator rather than
 * Math.random(). Random stars would differ between the server render and the
 * client hydration and React would (rightly) complain.
 */

// Mulberry32 -- small, fast, and most importantly deterministic, so the sky
// is the same sky on every render and in every process.
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  delay: number;
  duration: number;
}

function makeStars(count: number, seed: number): Star[] {
  const rand = seededRandom(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    // A few bright ones among many faint ones reads as a real sky; a uniform
    // brightness reads as noise. Hence the cubed distribution.
    const brightness = rand() ** 3;
    stars.push({
      cx: Math.round(rand() * 1000) / 10,
      cy: Math.round(rand() * 1000) / 10,
      r: Math.round((0.5 + brightness * 1.6) * 100) / 100,
      opacity: Math.round((0.25 + brightness * 0.7) * 100) / 100,
      delay: Math.round(rand() * 60) / 10,
      duration: Math.round((30 + rand() * 40) * 10) / 100,
    });
  }
  return stars;
}

const STARS = makeStars(140, 20260725);

export default function SpaceBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base gradient: lighter toward the top, as if lit from above. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#132140_0%,#080e1c_45%,#03060e_100%)]" />

      {/* Drifting color clouds. Blurred way past their own edges so they read
          as atmosphere rather than as two circles. */}
      <div className="gw-drift-a absolute -top-1/3 -left-1/4 h-[75vh] w-[75vh] rounded-full bg-gw-teal/12 blur-[120px]" />
      <div className="gw-drift-b absolute -right-1/4 top-1/4 h-[65vh] w-[65vh] rounded-full bg-gw-violet/12 blur-[130px]" />
      <div className="gw-drift-a absolute -bottom-1/4 left-1/3 h-[55vh] w-[55vh] rounded-full bg-gw-cyan/8 blur-[110px]" />

      {/* Stars. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={s.cx}
            cy={s.cy}
            // preserveAspectRatio="none" stretches the viewBox to the
            // viewport, which would turn round stars into ovals -- so the
            // radius is given in absolute px units, which the stretch leaves
            // alone.
            r={`${s.r}px`}
            fill="#dce9ff"
            opacity={s.opacity}
            style={{
              animation: `gw-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </svg>

      {/* Graticule: the lat/long grid, the one motif that says "this is about
          the globe" without drawing a globe. Masked to fade out toward the
          edges so it never draws attention to where it stops. */}
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(120 190 255 / 0.5) 1px, transparent 1px), linear-gradient(to bottom, rgb(120 190 255 / 0.5) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(120% 90% at 50% 0%, black 10%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(120% 90% at 50% 0%, black 10%, transparent 75%)',
        }}
      />

      {/* Vignette, to keep the corners from competing with content. */}
      <div className="absolute inset-0 bg-[radial-gradient(100%_100%_at_50%_40%,transparent_40%,#03060e_100%)]" />
    </div>
  );
}
