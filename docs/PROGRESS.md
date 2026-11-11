# Progress

Tracks what is built against [PROJECT_PLAN.md](PROJECT_PLAN.md), plus the decisions
and deviations agreed along the way.

## Standing decisions

| Decision           | Choice          | Notes                                             |
| ------------------ | --------------- | ------------------------------------------------- |
| First jurisdiction | India           | DPDP Act 2023 and Indian Contract Act packs first |
| Auth               | Clerk           | Organisations and roles built in                  |
| Background jobs    | Inngest         | Used from Phase 1                                 |
| Function region    | `bom1` (Mumbai) |                                                   |
| Package manager    | npm             |                                                   |

## Phase 0 — Foundations

| Plan item                                                      | Status                          |
| -------------------------------------------------------------- | ------------------------------- |
| Next.js app, TypeScript, Tailwind, shadcn/ui, ESLint, Prettier | Done                            |
| Push to GitHub                                                 | Owner (git is manual)           |
| Import into Vercel, Production and Preview                     | Owner (needs account)           |
| Neon Postgres, branch per preview, pgvector                    | Code done; owner provisions     |
| Drizzle schemas for `orgs`, `users`, `audit_log`               | Done, with RLS and tests        |
| Migrations in CI                                               | Changed, see below              |
| Clerk auth with organisations, protected routes                | Code done; needs keys to run    |
| Model router with tier env vars and fallback chain             | Done, unit-tested               |
| `/api/health/ai`                                               | Code done; needs API key to run |
| Sentry, Vercel Analytics, Langfuse                             | Code done; needs keys to run    |

### Deviations from the plan

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

| Criterion                                                    | Status                                      |
| ------------------------------------------------------------ | ------------------------------------------- |
| Sign up, create an org, see an empty dashboard on production | Not yet verified: needs Clerk, Neon, Vercel |
| CI runs lint, typecheck and tests on every PR                | Workflow written; runs once pushed          |
| Health check reaches all three model tiers                   | Not yet verified: needs `ANTHROPIC_API_KEY` |

### Open items carried forward

- Langfuse records model inputs and outputs. That is fine for the health ping, but
  before contract text flows through it (Phase 1) decide between masking,
  self-hosting, or metadata-only tracing.
- Clerk stores user accounts outside India. Note it in the DPDP subprocessor list
  (Phase 7).
