# Progress

Tracks what is built against [PROJECT_PLAN.md](PROJECT_PLAN.md), plus the decisions
and deviations agreed along the way.

## Standing decisions

| Decision           | Choice                 | Notes                                             |
| ------------------ | ---------------------- | ------------------------------------------------- |
| First jurisdiction | India                  | DPDP Act 2023 and Indian Contract Act packs first |
| Auth               | Clerk                  | Organisations and roles built in                  |
| Background jobs    | Inngest                | Used from Phase 1                                 |
| Function region    | `bom1` (Mumbai)        |                                                   |
| Package manager    | npm                    |                                                   |
| Model provider     | Gemini, free tier      | Replaces Claude: zero spend. See deviations       |
| Embeddings         | `gemini-embedding-001` | Replaces Voyage; same API key, free tier          |
| Hosting            | Vercel Hobby           | Free; non-commercial use only                     |

## Phase 0 — Foundations

| Plan item                                                      | Status                             |
| -------------------------------------------------------------- | ---------------------------------- |
| Next.js app, TypeScript, Tailwind, shadcn/ui, ESLint, Prettier | Done                               |
| Push to GitHub                                                 | Owner (git is manual)              |
| Import into Vercel, Production and Preview                     | Owner (needs account)              |
| Neon Postgres, branch per preview, pgvector                    | Code done; owner provisions        |
| Drizzle schemas for `orgs`, `users`, `audit_log`               | Done, with RLS and tests           |
| Migrations in CI                                               | Changed, see below                 |
| Clerk auth with organisations, protected routes                | Signed-out guards verified locally |
| Model router with tier env vars and fallback chain             | Done, unit-tested                  |
| `/api/health/ai`                                               | Verified locally, all tiers ok     |
| Sentry, Vercel Analytics, Langfuse                             | Code done; needs keys to run       |

### Deviations from the plan

- **Gemini replaces Claude throughout** (owner decision, 2026-11-11: no spend).
  Tier defaults: reasoning `gemini-3.8-flash`, its fallback and the standard tier
  `gemini-3.6-flash`, fast `gemini-3.5-flash-lite`. Wherever the plan says Fable,
  Opus, Sonnet or Haiku, read the matching tier. A 429 (quota used up) now also
  triggers the fallback. Consequences to revisit: no free Batch API (Phase 6 bulk
  scan), and the Phase 2–3 accuracy targets were set with a stronger model in mind.
- **Migrations run in the Vercel build, not in GitHub Actions.** With a Neon branch
  per preview deploy, only the Vercel build knows which database a deployment is
  attached to. GitHub Actions still runs lint, typecheck, tests and format check.
- **Protected area is "everything not public"**, not a `/app/*` prefix. Routes are
  `/dashboard`, `/contracts` and so on, matching the plan's repository layout.
- **`users` has one row per org membership** (unique on org + Clerk user), since a
  person can belong to several organisations.
- **`orgs.region` defaults to `in`.**
- **Next.js 16 names the middleware file `proxy.ts`.**

### Exit criteria

| Criterion                                                    | Status                                        |
| ------------------------------------------------------------ | --------------------------------------------- |
| Sign up, create an org, see an empty dashboard on production | Not yet: needs Neon and a Vercel deploy       |
| CI runs lint, typecheck and tests on every PR                | Workflow written; runs once pushed            |
| Health check reaches all three model tiers                   | Verified locally on 2026-11-11 (all three ok) |

### Open items carried forward

- Google uses free-tier Gemini content to improve its products. Real customer
  contracts must not go through it; moving to a paid tier is a launch blocker
  (Phase 7).
- Langfuse records model inputs and outputs. That is fine for the health ping, but
  before contract text flows through it (Phase 1) decide between masking,
  self-hosting, or metadata-only tracing.
- Clerk stores user accounts outside India. Note it in the DPDP subprocessor list
  (Phase 7).
