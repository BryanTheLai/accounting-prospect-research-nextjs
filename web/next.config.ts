import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.OUTBOUNDER_BUILD_DIR || ".next",
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["rather-gnu-gathered-diagram.trycloudflare.com"],
  devIndicators: false,
  agentRules: false,
};

export default nextConfig;
