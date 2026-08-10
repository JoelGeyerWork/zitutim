import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js, which is what the
  // Dockerfile's runtime stage copies instead of a full node_modules.
  output: "standalone",
};

export default nextConfig;
