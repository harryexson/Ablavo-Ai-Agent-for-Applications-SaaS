/** @type {import('next').NextConfig} */
const api = process.env.API_URL ?? "http://localhost:4000";
export default {
  reactStrictMode: true,
  transpilePackages: ["@ablavo/ui"],
  // Same-origin API access: cookies stay first-party and no CORS is needed for the dashboard.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};
