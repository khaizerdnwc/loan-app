import type { NextConfig } from "next";

/** Headers on every page: no framing (clickjacking on the approve dialogs), no sniffing. */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
];

const config: NextConfig = {
  // The shared component package ships TypeScript source; @loan/core is a compiled build.
  transpilePackages: ["@loan/ui"],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default config;
