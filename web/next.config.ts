import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // `matching` is a `file:../matching` dependency (see package.json) --
  // Turbopack only follows that symlink to its real, out-of-project-root
  // location if root is set to an ancestor of both directories.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
