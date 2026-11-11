import "server-only";

import { OpenTelemetry } from "@ai-sdk/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";

/**
 * Sends a trace of every AI SDK call (model, tokens, cost, latency) to
 * Langfuse. It uses its own tracer provider rather than the global one, so it
 * never competes with Sentry's tracing setup.
 */
export function registerLlmTracing() {
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
        // Serverless functions can freeze right after responding.
        exportMode: "immediate",
      }),
    ],
  });

  registerTelemetry(new OpenTelemetry({ tracer: provider.getTracer("legalgpt.ai") }));
}
