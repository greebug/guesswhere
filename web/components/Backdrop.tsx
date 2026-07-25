/**
 * The page backdrop: a graticule, a little lamplight, and paper grain.
 *
 * This replaced a starfield-and-drifting-nebula version, for two reasons. The
 * first was a real bug -- its stars were drawn in an SVG with
 * `preserveAspectRatio="none"`, on the assumption that a radius given in `px`
 * units would resist the viewBox stretch. It doesn't: the stretch applies to
 * the whole coordinate system, so 1.5px radii came out as 20px grey ovals
 * scattered across every screen, sitting on top of the text. The second was
 * that even working, it was too much -- the chrome was competing with the
 * satellite imagery that is the actual subject.
 *
 * What's left is flat color, a map grid, and grain. All CSS and inline SVG:
 * Mapbox is the only imagery this project ever fetches, and a decorative
 * background has no business adding a request to any page's critical path.
 */
export default function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Lamplight from above -- the one thing keeping the top of a long page
          from being a flat field of one color. */}
      <div className="absolute inset-0 bg-[radial-gradient(110%_60%_at_50%_0%,#1a242e_0%,#121a22_40%,#0e141a_100%)]" />

      {/* Graticule. The lat/long grid is the one motif that says "atlas"
          without drawing a map, and it doubles as an alignment grid for the
          eye. Masked so it fades out rather than stopping at an edge. */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(240 234 222 / 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgb(240 234 222 / 0.05) 1px, transparent 1px)',
          backgroundSize: '96px 96px',
          maskImage: 'radial-gradient(120% 80% at 50% 0%, black 20%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(120% 80% at 50% 0%, black 20%, transparent 80%)',
        }}
      />

      {/* Paper grain. Fractal noise at a low opacity is what stops a large
          dark area reading as a flat digital void, and it's the texture a
          printed atlas would actually have. */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.035]">
        <filter id="gw-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#gw-grain)" />
      </svg>
    </div>
  );
}
