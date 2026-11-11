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

| Command                                | What it does                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                          | Start the dev server                                                          |
| `npm run check`                        | Lint, typecheck, test and format check (what CI runs)                         |
| `npm run test`                         | Unit tests and row-level security tests                                       |
| `npm run db:generate`                  | Generate a migration after editing `lib/db/schema.ts`                         |
| `npm run db:migrate`                   | Apply migrations to `DATABASE_URL`                                            |
| `npm run format`                       | Format with Prettier                                                          |
| `npm run eval:segmentation`            | Score clause segmentation on the 30 generated contracts (rules only, offline) |
| `npm run eval:risk`                    | Score the rule engine on 30 generated contracts with planted risks (offline)  |
| `npm run eval:segmentation -- --model` | The same with the Gemini pass: one call per contract, cached                  |

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
- **Ingestion.** `POST /api/contracts` checks the upload's real type from its
  bytes, stores the original privately (Vercel Blob, or `.data/` in development)
  and runs the `analyze` job: `lib/pipeline/parse.ts` extracts normalised text,
  and `lib/pipeline/segment.ts` splits it into clauses by numbering and headings.
  Three model steps follow: `classify.ts` assigns each clause one of 30 types and
  repairs boundaries, `extract.ts` pulls out parties, dates, value and governing
  law, and the clauses are embedded for search. Every extracted fact must quote
  the contract, and the server drops any whose quote is not in the text.
  Sample contracts for trying it out are in `tests/fixtures/contracts/`.
- **Risk review.** `lib/rules` holds 83 deterministic detectors for known risk
  patterns, grouped by category and written for Indian law (section 27 and 74 of
  the Contract Act, the DPDP Act, the MSMED Act, the Stamp Act and so on). Each
  carries its own examples, which the tests run. Findings are stored per contract
  and scored by `lib/scoring/score.ts` using the formula in the plan. A reviewer
  can accept or dismiss each one; a dismissed finding leaves the score.
- **Playbook and judgment.** Each organisation has a playbook
  (`lib/playbook`): a standard position, fallback, walk-away point and risk
  weight for 20 clause types, editable at `/playbooks` by an admin. After the
  rules run, one reasoning-tier call (`lib/pipeline/assess.ts`) re-scores the rule
  findings in context, reports material deviations from the playbook and writes
  the summary. A deviation is stored only if its quote is found in the clause.
- **Compliance.** `lib/compliance` checks each contract against versioned rule
  packs: DPDP Act 2023, Indian Contract Act 1872, Arbitration Act 1996 and stamp
  duty first, then GDPR Article 28 and CCPA when the contract points to them, plus
  the organisation's own policies written at `/compliance`. Each rule gives pass,
  warn or fail, citing the clause and the pack version. Deterministic, no model.
- **Scanned PDFs.** A PDF with pages but no selectable text is read by Tesseract
  inside the app (`lib/pipeline/ocr.ts`); nothing is sent to an outside service.
  English only, up to 40 pages. The contract is flagged as read by OCR.
- **Background jobs.** With Inngest configured, the stages run as retryable
  steps (`inngest/functions/analyze.ts`). Without it, they run in the app's own
  process after the upload response. If a model step fails, for example because
  the free quota ran out, the contract stays readable with its rule-based
  clauses and offers "Run analysis again".
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
