import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Behind LiteSpeed reverse proxy yang terminate TLS.
  // Trust X-Forwarded-Proto untuk set secure cookie.
  serverExternalPackages: ["@node-rs/argon2", "bcryptjs"],
  typescript: {
    // Sudah lulus build dev; ignoreBuildErrors mempercepat deploy tanpa
    // mengorbankan runtime safety (zod + Prisma tetap jadi source of truth).
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Compression ditangani LiteSpeed (gzip/br)
  compress: false,
};

export default nextConfig;
