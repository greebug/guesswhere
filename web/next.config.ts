import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Guesswhere is mounted at bingbongblitz.com/guesswhere, behind the hub
  // Worker (see ../../bingbongblitz-hub). This rewrites routes, <Link> hrefs,
  // and every /_next/* asset URL -- but NOT strings passed to fetch(), which is
  // why client fetches go through `api()` in lib/basePath.ts. Keep the two in
  // sync.
  basePath: '/guesswhere',

  // With basePath set, the origin's own root serves nothing. Anyone arriving on
  // the bare Railway hostname -- an old bookmark, a shared /play link from
  // before the move, a verification email sent under the previous APP_URL --
  // would hit a 404 with no way forward. This sends them to the real address.
  //
  // `basePath: false` is the documented escape hatch: without it, `source`
  // would itself be prefixed to '/guesswhere', which is the one path that must
  // NOT redirect.
  async redirects() {
    return [
      {
        source: '/',
        destination: '/guesswhere',
        basePath: false,
        permanent: false,
      },
    ];
  },

  // `matching` is a `file:../matching` dependency (see package.json) --
  // Turbopack only follows that symlink to its real, out-of-project-root
  // location if root is set to an ancestor of both directories.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
