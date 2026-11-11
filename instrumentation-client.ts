import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./lib/observability/sentry-options";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    ...sentryOptions,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
