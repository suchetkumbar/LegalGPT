# LegalGPT

Contract review for Indian businesses: risk scoring, clause analysis and compliance
checks, with every finding cited to the clause it came from. Not legal advice.

The full plan is in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md). Progress against it
is tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind 4 + shadcn/ui ·
Clerk (auth, organisations) · Neon Postgres + pgvector · Drizzle ORM · Vercel AI SDK
with Gemini (free tier) · Inngest (from Phase 1) · Sentry, Vercel Analytics, Langfuse · Vitest.

## Local setup

Requires Node 22 or newer.

```bash
npm install
cp .env.example .env.local   # then fill it in, see below
npm run db:migrate           # creates tables, the app_user role and RLS policies
npm run dev
```

Minimum variables to run the app locally:

| Variable                                                | Where to get it                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk dashboard → API keys. Enable **Organizations** too.             |
| `DATABASE_URL`                                          | Neon project → connection string (use the pooled one).                |
| `GOOGLE_GENERATIVE_AI_API_KEY`                          | Google AI Studio → API keys. Only needed for `/api/health/ai` so far. |

Everything else in `.env.example` is optional in development.

## Commands

| Command               | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Start the dev server                                  |
| `npm run check`       | Lint, typecheck, test and format check (what CI runs) |
| `npm run test`        | Unit tests and row-level security tests               |
| `npm run db:generate` | Generate a migration after editing `lib/db/schema.ts` |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`                    |
| `npm run format`      | Format with Prettier                                  |

## How the pieces fit

- **Tenant isolation.** Every table has row-level security on `org_id`. Request code
  queries through `withOrg(orgId, tx => ...)` in `lib/db`, which runs as the
  `app_user` role with the org pinned for that transaction. `adminDb()` bypasses
  RLS and is only for cross-tenant system work (Clerk sync, webhooks, cron).
  `tests/db/rls.test.ts` applies the real migrations to an in-process Postgres and
  tries to read and write across orgs.
- **Model router.** `lib/ai/router.ts` maps three tiers (`reasoning`, `standard`,
  `fast`) to models from the environment. Reasoning calls fall back
  Gemini 3.8 Flash → Gemini 3.6 Flash on a 5xx, a timeout, the model being
  unavailable or its free quota running out, and the result records which model
  answered.
  `GET /api/health/ai` pings all three tiers (needs a session or
  `Authorization: Bearer $CRON_SECRET`).
- **Auth.** `proxy.ts` makes everything private except the landing page, the
  sign-in and sign-up pages, the health check and webhooks.
  `lib/auth/context.ts` returns the current org and user as database rows, creating
  them from Clerk on first sight. `POST /api/webhooks/clerk` keeps them in step
  afterwards.
- **Observability.** Sentry is configured to collect no request bodies, cookies,
  headers or model inputs/outputs, because contracts are confidential. Each
  integration is skipped when its env vars are unset.

## Cost

The project is set up to cost nothing. The model defaults are all on Google's free
tier, and every other service has a free plan. Two things to know:

- Create the Gemini key in a Google Cloud project with **no billing account**, so
  it cannot be charged. When a quota runs out, calls fail with a 429 instead.
- Google uses free-tier content to improve its products. Use sample or public
  contracts only until the app moves to a paid tier.

## Deploying

The Vercel function region is `bom1` (Mumbai). The build command runs
`db:migrate` before `next build`, so each deployment migrates the database it is
connected to (the Neon branch for a preview, the main branch for production).
