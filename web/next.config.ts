import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.DREZIVO_NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  // npm workspaces hoist `next` to the repository root, so Turbopack must resolve from there.
  turbopack: { root: path.join(__dirname, "..") },
};

export default nextConfig;
