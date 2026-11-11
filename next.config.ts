import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * Security headers on every response. No content security policy yet: Clerk,
 * Sentry and Vercel Analytics load scripts from their own domains, and a
 * policy that blocks them breaks sign-in. That needs testing on a deployment.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  // OCR: the native canvas and the Tesseract worker must be loaded from
  // node_modules at run time, not bundled.
  serverExternalPackages: ["tesseract.js", "@napi-rs/canvas"],
  // Files OCR opens by path, which the build cannot discover by itself.
  outputFileTracingIncludes: {
    "/api/contracts": [
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**",
      "./node_modules/tesseract.js/src/worker-script/**",
      "./node_modules/tesseract.js-core/**",
    ],
    "/api/inngest": [
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**",
      "./node_modules/tesseract.js/src/worker-script/**",
      "./node_modules/tesseract.js-core/**",
    ],
  },
  experimental: {
    // Uploads pass through proxy.ts, which buffers request bodies. The default
    // cap is 10 MB; contracts may be up to 20 MB.
    proxyClientMaxBodySize: "25mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Source maps upload only when SENTRY_AUTH_TOKEN is present (CI and Vercel).
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
