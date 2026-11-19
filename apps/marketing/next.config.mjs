/** @type {import('next').NextConfig} */
const api = process.env.API_URL ?? "http://localhost:4000";
// The developer console is a separate Next.js app (Vercel multi-zone) served under /console on this domain,
// so the sign-in session set here is the same one the console reads.
const consoleOrigin = process.env.CONSOLE_URL ?? "http://localhost:3001";

import path from "node:path";
import { fileURLToPath } from "node:url";

export default {
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  reactStrictMode: true,
  transpilePackages: ["@ablavo/ui", "@ablavo/billing", "@ablavo/auth", "@ablavo/shared"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/:path*` },
      { source: "/console", destination: `${consoleOrigin}/console` },
      { source: "/console/:path*", destination: `${consoleOrigin}/console/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
        ],
      },
    ];
  },
};
