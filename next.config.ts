import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@mysten/walrus', '@mysten/walrus-wasm'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'unpkg.com',
      },
    ],
  },
};

export default nextConfig;
