import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./lib/observability/sentry-options";

/**
 * Server start-up hook. Each integration is skipped when its env vars are
 * unset, so local development works with none of them configured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? "development",
      ...sentryOptions,
    });
  }

  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    const { registerLlmTracing } = await import("./lib/observability/langfuse");
    registerLlmTracing();
  }
}

export const onRequestError = Sentry.captureRequestError;
