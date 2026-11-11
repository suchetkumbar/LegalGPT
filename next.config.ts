import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
