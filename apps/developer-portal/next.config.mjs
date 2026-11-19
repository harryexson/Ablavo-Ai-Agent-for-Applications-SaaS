/** @type {import('next').NextConfig} */
const api = process.env.API_URL ?? "http://localhost:4000";
export default {
  reactStrictMode: true,
  // Served under the landing-page domain at /console (Vercel multi-zone) so one sign-in covers both.
  basePath: "/console",
  transpilePackages: ["@ablavo/ui", "@ablavo/shared", "@ablavo/sdk"],
  // Same-origin API access: cookies stay first-party and no CORS is needed for the dashboard.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/:path*`, basePath: false }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};
