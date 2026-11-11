import type { init } from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

/**
 * Shared by the server and browser SDKs.
 *
 * Sentry collects request bodies, cookies, user details and model
 * inputs/outputs by default. Contracts are confidential, so every category
 * that could carry contract text or personal data is switched off. Errors
 * still arrive with stack traces, which is all we need.
 */
export const sentryOptions = {
  tracesSampleRate: 0.1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
  },
} satisfies SentryOptions;
