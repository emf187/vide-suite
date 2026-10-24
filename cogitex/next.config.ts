import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep drivers out of the bundler so their native/wasm assets load from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // Include migration SQL in the bundle so the dev fallback (PGlite) can self-migrate at runtime.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**"],
  },
  // Document uploads arrive through server actions (service caps: 5 MB docs / 10 MB media).
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // M8 security headers. CSP keeps 'unsafe-inline' only for scripts/styles because
  // Next.js App Router inlines flight/bootstrap data and the theme boot script.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
