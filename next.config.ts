import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.DREZIVO_NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
