# LegalGPT — Complete Project Document

Nov 11, 2026 · @Suchet k

## Executive summary

LegalGPT ships in 8 phases over about 15 weeks as a Next.js app on Vercel. Each phase is deployable on its own and builds on the one before. Claude Fable 5.2 handles the reasoning-heavy legal work: drafting, risk scoring, clause deviation analysis, compliance reasoning and negotiation redlines. Cheaper models handle extraction and chat.

**Product vision.** LegalGPT turns static contracts into structured, searchable, scored data. A business uploads or drafts a contract and gets back four things: a risk score with reasons, a clause-by-clause comparison against its own playbook, a compliance check against the rules that apply to it, and a list of obligations and deadlines. Every finding cites the exact clause text it came from.

**Who it is for.** Startup founders and SMB operations teams without in-house counsel, in-house legal teams that want a first-pass reviewer, and procurement teams handling vendor paper at volume.

**What it is not.** LegalGPT does not give legal advice. It is a review assistant: every output carries a disclaimer, and high-risk findings are routed to a human reviewer before anyone acts on them.

**Guiding principles**

- **Grounded:** every finding links to the clause it quotes. No citation means no finding.
- **Deterministic first:** a rule engine catches the known patterns. The LLM handles judgment, not regex work.
- **Right model per task:** Fable 5.2 where reasoning quality changes the outcome, Haiku and Sonnet where speed and cost matter more.
- **Ship every phase:** every phase ends in a production deploy on Vercel with its own exit criteria.

## Feature set

The product has 4 core features from the original brief and 10 additional ones. Each additional feature reuses the clause store that Phase 1 builds.

### Core features

| Feature | What the user gets | How it works | Phase |
| --- | --- | --- | --- |
| Automated contract generation | A tailored first draft (NDA, MSA, SOW, SaaS, employment, consulting) from a short form | Template skeleton + clause library + Fable 5.2 fills and adapts clauses to the stated constraints | 4 |
| Risk detection and scoring | A 0–100 risk score, broken down by category (liability, IP, termination, payment, data, renewal) | Rule engine flags known patterns, Fable 5.2 judges severity and likelihood with a quoted reason | 2 |
| Clause analysis | Each clause typed, compared to the playbook standard, with the deviation and a suggested replacement | Haiku 5.5 segments and classifies clauses, Fable 5.2 explains the deviation and drafts the fix | 2 |
| Compliance intelligence | A pass, warn or fail per rule for GDPR, India DPDP Act 2023, CCPA, the Indian Contract Act and internal policy | Versioned rule packs + Fable 5.2 reasoning over the relevant clauses, with citations | 3 |

### Additional features

| Feature | What the user gets | Phase |
| --- | --- | --- |
| Ask the contract | Chat with one contract or the whole portfolio, answers cite clause numbers (RAG over pgvector) | 5 |
| Obligation and deadline tracker | Renewal dates, notice periods and payment milestones extracted to a calendar, with email reminders and .ics export | 5 |
| Version compare and redline | Side-by-side diff of two versions, with each change marked as favourable, neutral or unfavourable | 4 |
| Negotiation assistant | Counter-proposal language for each unfavourable clause, in three tones: firm, balanced, conciliatory | 4 |
| Custom playbooks | The organisation defines its standard positions, fallbacks and walk-away points per clause type | 2 |
| Entity extraction | Parties, signatories, governing law, jurisdiction, contract value, currency, term | 1 |
| Portfolio analytics | Risk distribution across all contracts, top recurring deviations, upcoming renewals, exposure by counterparty | 6 |
| Review workflow | Assign a contract, set a status, approve or reject findings, comment threads, audit trail | 6 |
| Exports | Risk report as PDF, the redlined contract as .docx, findings as CSV or JSON | 4 |
| Bulk scan | Upload a folder of contracts and get them scored overnight through the Batch API | 6 |

**Later, outside this plan:** a Microsoft Word add-in, e-signature integration (DocuSign or Zoho Sign), multilingual review (Hindi first), and a Slack bot for renewal alerts.

## System architecture and tech stack

LegalGPT is one Next.js app on Vercel. Short requests run in serverless functions. Long analyses run as background jobs that stream progress back to the UI. All data lives in Postgres with pgvector, and uploaded files live in Vercel Blob.

&#91;embedded content: LegalGPT architecture on Vercel · 7 components\]

Files go straight from the browser to Blob. API routes only enqueue work, and every model call goes through the router so the Fable fallback applies everywhere.

**Request path.** The browser uploads a file to Vercel Blob and calls `/api/contracts`. That call creates a contract row and enqueues an `analyze` job. The job runs the pipeline in order: parse, segment, extract, embed, rule-check, LLM analysis, score. It writes each stage's output to Postgres, and the UI subscribes to progress over server-sent events.

**Why background jobs.** A 40-page MSA can need 60+ model calls. A user request should never wait on that. The job runner retries a failed stage without redoing the stages that already succeeded.

### Tech stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Framework | Next.js (App Router), TypeScript, React Server Components | Native on Vercel; API routes and UI in one repo |
| UI | Tailwind CSS + shadcn/ui, TanStack Table, react-pdf viewer | Fast to build, accessible components |
| AI SDK | Vercel AI SDK with the Anthropic provider, plus `@anthropic-ai/sdk` for the Batch API | Streaming, tool calls and structured output with Zod schemas |
| Database | Postgres on Neon (Vercel Marketplace) + pgvector | One store for relational data and embeddings; branch per preview deploy |
| ORM | Drizzle ORM + drizzle-kit migrations | Typed SQL; migrations run in CI |
| File storage | Vercel Blob | Signed uploads straight from the browser |
| Background jobs | Inngest (Vercel Marketplace) or Vercel Workflow | Durable, retryable multi-step pipelines |
| Cache and rate limits | Upstash Redis | Per-user and per-org token budgets, idempotency keys |
| Auth and orgs | Clerk (organisations + roles) or Auth.js | Multi-tenant orgs, SSO later |
| Parsing | `unpdf` for PDF text, `mammoth` for .docx; OCR fallback for scans | Covers most uploads with no external service |
| Embeddings | Voyage AI `voyage-law-2` (legal-tuned) or `voyage-3` | Better recall on legal text than general embeddings |
| Document output | `docx` npm package for redlines; `@react-pdf/renderer` for reports | Server-side generation |
| Scheduling | Vercel Cron | Daily obligation reminders, nightly bulk scans |
| Email | Resend | Reminders and review notifications |
| Observability | Vercel Analytics, Sentry, Langfuse (LLM traces and cost) | Errors, latency and per-call token cost |
| Testing | Vitest, Playwright, a custom eval harness | Unit, end-to-end and model-quality gates |

## AI model strategy

Claude Fable 5.2 (`claude-fable-5-2`) runs every task where reasoning quality decides whether a finding is right: drafting, risk judgment, deviation analysis, compliance reasoning and redlines. Haiku 5.5 and Sonnet 5.5 run high-volume extraction and chat. All calls go through one model router, so changing a task's model is a config change.

### Task-to-model map

| Task | Model | Why this model | Phase |
| --- | --- | --- | --- |
| Clause segmentation and type classification | Haiku 5.5 (`claude-haiku-5-5`) | High volume, simple labels, needs low latency | 1 |
| Entity extraction (parties, dates, value, governing law) | Haiku 5.5 | Structured output against a fixed schema | 1 |
| **Clause deviation analysis against the playbook** | **Fable 5.2** | Has to tell a harmless rewording from a material shift in risk | 2 |
| **Risk severity and likelihood judgment** | **Fable 5.2** | Weighs interacting clauses, such as an uncapped indemnity alongside a liability cap | 2 |
| **Compliance reasoning per rule** | **Fable 5.2** | Multi-step legal reasoning across clauses, with the citation for each step | 3 |
| **Contract drafting from requirements** | **Fable 5.2** | Long, internally consistent output with cross-references kept correct | 4 |
| **Negotiation counter-proposals and redlines** | **Fable 5.2** | Needs the business context, the playbook fallback and the tone together | 4 |
| Version diff classification (favourable or not) | Sonnet 5.5 (`claude-sonnet-5-5`) | Moderate reasoning at volume | 4 |
| Ask the contract (chat with RAG) | Sonnet 5.5, escalating to Fable 5.2 on "deep analysis" | Fast streaming answers by default | 5 |
| Obligation and deadline extraction | Sonnet 5.5 | Date arithmetic and conditional terms | 5 |
| Executive summary of a contract | Sonnet 5.5 | Summarisation at good quality and speed | 2 |
| Query routing and intent detection | Haiku 5.5 | One cheap call before the expensive ones | 5 |
| **Eval judge (grading outputs against gold labels)** | **Fable 5.2** | The judge must be stronger than the models it grades | 7 |
| Bulk portfolio scan | Fable 5.2 through the Batch API | Same quality as interactive review, at lower cost and off-peak | 6 |

### How Fable 5.2 is used well

1. **Structured output only.** Every Fable call returns JSON validated by a Zod schema: `finding`, `severity`, `likelihood`, `quoted_text`, `clause_id`, `reasoning`, `suggested_fix`. An invalid response is retried once and then marked for human review.
2. **Prompt caching.** The system prompt, the organisation's playbook and the rule pack sit in a cached prefix. Only the clause batch changes between calls.
3. **Clause batching.** The job sends 8–12 related clauses per call (all liability clauses together, say) rather than one call per clause. The model sees the interactions, and the call count drops.
4. **Extended thinking for hard cases.** Thinking is turned on for compliance reasoning and for findings the rule engine flagged as high severity, and left off for routine clauses.
5. **Citations required.** The prompt rejects any finding without a verbatim quote, and the server checks that each quote exists in the source text before saving it.

### Router and fallback

The router reads `MODEL_TIER_REASONING`, `MODEL_TIER_STANDARD` and `MODEL_TIER_FAST` from the environment. The fallback chain for reasoning tasks is Fable 5.2 → Opus 5.5 (`claude-opus-5-5`) → Sonnet 5.5. It triggers on a 5xx, a timeout, or access being unavailable.

This matters in practice: Anthropic suspended access to Fable from June 12 to July 1, 2026 to comply with US export controls. A fallback chain keeps the product working through an interruption like that. Each finding records which model produced it, and findings from a fallback model show a badge in the UI.

## Data model and API design

There are 12 tables, all scoped by `org_id` and protected by row-level security. Contracts break down into clauses, and every finding points to exactly one clause.

### Tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `orgs` | id, name, plan, region | The tenant boundary |
| `users` | id, org\_id, email, role (admin, reviewer, viewer) | Synced from Clerk |
| `contracts` | id, org\_id, title, type, counterparty, status, blob\_url, parent\_id, version, risk\_score, created\_by | `parent_id` links versions together |
| `clauses` | id, contract\_id, ordinal, heading, text, type, start\_offset, end\_offset, embedding vector(1024) | HNSW index on the embedding column |
| `entities` | id, contract\_id, kind (party, date, amount, law), value, clause\_id | Feeds the filters and the obligations table |
| `playbooks` | id, org\_id, name, version, is\_default | One active version per org |
| `playbook_positions` | id, playbook\_id, clause\_type, standard\_text, fallback\_text, walkaway, risk\_weight | The standard that deviations are measured against |
| `rule_packs` | id, code (GDPR, DPDP, CCPA, ICA, INTERNAL), version, rules jsonb | Versioned, so old reports stay reproducible |
| `findings` | id, contract\_id, clause\_id, kind (risk, deviation, compliance), category, severity 1–5, likelihood 1–5, quoted\_text, reasoning, suggested\_fix, model, status (open, accepted, dismissed) | Every finding cites one clause |
| `obligations` | id, contract\_id, clause\_id, owner\_party, description, due\_date, recurrence, notice\_days, reminder\_sent\_at | Drives Vercel Cron reminders |
| `jobs` | id, contract\_id, kind, stage, status, error, tokens\_in, tokens\_out, cost\_usd | Progress tracking and cost accounting |
| `audit_log` | id, org\_id, actor\_id, action, target, diff jsonb, at | Append-only |

### Risk score

Each finding contributes severity × likelihood × the playbook weight for its clause type. The contract score normalises the total to 0–100, and any single critical finding (severity 5, likelihood 4 or more) sets a floor of 70.

```latex
R = \min\left(100,\ \max\left(F,\ 100 \cdot \frac{\sum_i s_i \, l_i \, w_{c(i)}}{25 \sum_c w_c}\right)\right)
```

Here s is severity, l is likelihood, w is the clause-type weight, and F is 70 when a critical finding exists (0 otherwise). Bands: 0–29 low, 30–59 medium, 60–79 high, 80–100 critical.

### API routes

| Method and path | Purpose | Runtime |
| --- | --- | --- |
| `POST /api/upload` | Issue a signed Vercel Blob upload token | Edge |
| `POST /api/contracts` | Create a contract and enqueue the analyze job | Node |
| `GET /api/contracts/:id` | Contract, clauses, findings and score | Node |
| `GET /api/contracts/:id/stream` | Server-sent events with job progress | Node |
| `POST /api/contracts/:id/compare` | Diff against another version | Node, background |
| `POST /api/generate` | Draft a contract from a template and requirements (streams) | Node |
| `POST /api/negotiate` | Counter-proposals for chosen findings | Node |
| `POST /api/chat` | Ask the contract or the portfolio (streams, RAG) | Node |
| `PATCH /api/findings/:id` | Accept, dismiss or comment on a finding | Node |
| `GET/PUT /api/playbooks/:id` | Read or edit playbook positions | Node |
| `GET /api/obligations` | Upcoming obligations; `?format=ics` exports a calendar | Node |
| `GET /api/analytics` | Portfolio aggregates | Node |
| `POST /api/inngest` | Job runner endpoint | Node |
| `GET /api/cron/reminders` | Daily reminder sweep, protected by `CRON_SECRET` | Node |

## Phased implementation plan

The plan has 8 phases over about 15 weeks, assuming one or two developers. Each phase uses the previous phase's outputs, ends with a production deploy, and must pass its exit criteria before the next phase starts. Fable 5.2 comes in at Phase 2, once clean clause data exists for it to reason over.

&#91;embedded content: LegalGPT roadmap · 8 phases, about 15 weeks\]

Read left to right, then down: Phase 1's clause store feeds every later phase, and Fable 5.2 runs in five of the eight phases.

### Phase 0 — Foundations (week 1)

**Goal:** an empty, deployable, multi-tenant app with CI. **Builds on:** nothing.

- [ ] Create the Next.js app with TypeScript, Tailwind, shadcn/ui, ESLint and Prettier; push it to GitHub
- [ ] Import the repo into Vercel; set up Production (`main`) and Preview (every PR) environments
- [ ] Add Neon Postgres from the Vercel Marketplace, with a branch per preview; enable pgvector
- [ ] Set up Drizzle schemas for `orgs`, `users` and `audit_log`; run migrations in GitHub Actions
- [ ] Add Clerk auth with organisations, and middleware that protects `/app/*`
- [ ] Build the model router module (`lib/ai/router.ts`) with tier env vars and the fallback chain, plus a `/api/health/ai` check
- [ ] Add Sentry, Vercel Analytics and Langfuse tracing

**Exit criteria:** sign up, create an org and see an empty dashboard on the production URL; CI runs lint, typecheck and tests on every PR; the health check reaches all three model tiers.

### Phase 1 — Ingestion and the clause engine (weeks 2–3)

**Goal:** turn any uploaded contract into structured clauses and entities. **Builds on:** Phase 0 auth, DB and router.

- [ ] Drag-and-drop upload to Vercel Blob (PDF, .docx, .txt; 20 MB limit)
- [ ] Parsing service: `unpdf` and `mammoth` to plain text with character offsets; OCR fallback for scanned PDFs
- [ ] Set up Inngest and the `analyze` job, with stages `parse → segment → extract → embed`
- [ ] Segmentation: heading and numbering heuristics first, then **Haiku 5.5** fixes the boundaries and assigns a clause type from 30 types
- [ ] Entity extraction with **Haiku 5.5** (parties, effective date, term, value, governing law)
- [ ] Embed each clause with Voyage and store it in `clauses.embedding` with an HNSW index
- [ ] Contract viewer: the document on the left, the clause outline on the right, a click scrolls to the clause
- [ ] SSE progress bar driven by the `jobs` table

**Exit criteria:** on a test set of 30 contracts, clause boundaries are at least 95% correct and type labels at least 90% correct; a 20-page contract finishes ingestion in under 60 seconds.

### Phase 2 — Risk detection, scoring and clause analysis (weeks 4–5)

**Goal:** the core review experience. **Builds on:** Phase 1 typed clauses and entities.

- [ ] Rule engine (`lib/rules`): 60+ deterministic detectors, such as unlimited liability, auto-renewal with a notice window over 60 days, unilateral termination, a one-sided indemnity, missing IP assignment, and payment terms over 60 days
- [ ] Default playbook seeded with standard positions for 20 clause types; a playbook editor UI
- [ ] **Fable 5.2 deviation analysis:** batch clauses by type with the matching playbook position; return the deviation, whether it is material, and the suggested standard text
- [ ] **Fable 5.2 risk judgment:** severity and likelihood for each rule hit and each material deviation, with reasoning and a verbatim quote
- [ ] Server-side quote check: drop any finding whose quote is not in the source text
- [ ] Scoring service using the risk score formula; a category breakdown radar chart
- [ ] Findings panel: filter by severity, accept or dismiss, "show in document" highlight
- [ ] Executive summary with **Sonnet 5.5**

**Exit criteria:** on 30 contracts labelled by a lawyer or law student, high-severity risk recall is at least 85% and precision at least 75%; zero findings without a valid quote; median analysis cost per contract is logged.

### Phase 3 — Compliance intelligence (weeks 6–7)

**Goal:** a pass, warn or fail per regulation and internal policy. **Builds on:** Phase 2 findings pipeline and playbooks.

- [ ] Versioned rule packs as JSON with an id, description, applicability conditions, the clause types to check and legal references: GDPR (Art. 28 processor terms), India DPDP Act 2023, CCPA/CPRA, the Indian Contract Act 1872 (for example, s.27 on restraint of trade), and stamp-duty reminders
- [ ] Applicability step: decide which packs apply from the extracted entities (governing law, data processing present, the parties' locations)
- [ ] **Fable 5.2 compliance reasoning**, with extended thinking: for each rule, retrieve the relevant clauses by vector search and type, then return pass, warn or fail with a citation and a fix
- [ ] Internal policy builder: the org writes rules in plain English, Fable 5.2 converts them to the rule-pack JSON, and an admin approves them
- [ ] Compliance tab with a matrix of rules against status; findings merged into the same review flow

**Exit criteria:** on a 25-contract compliance gold set, verdicts are at least 85% accurate; every verdict cites the rule pack version used.

### Phase 4 — Generation, comparison and negotiation (weeks 8–9)

**Goal:** move from reviewing contracts to producing them. **Builds on:** Phase 2 playbook and Phase 3 compliance checks.

- [ ] Template library: NDA (mutual and one-way), MSA, SOW, SaaS subscription, consulting and employment offer, as clause skeletons
- [ ] Generation wizard: a requirements form (parties, jurisdiction, term, value, risk appetite), then **Fable 5.2** drafts with streaming output, using the org's playbook standard text
- [ ] Self-check: each generated draft goes straight through the Phase 2 and Phase 3 pipelines, and a draft scoring above 40 is regenerated once with the findings as feedback
- [ ] Version compare: align clauses by type and embedding similarity, show a word-level diff, and have **Sonnet 5.5** mark each change as favourable, neutral or unfavourable
- [ ] **Fable 5.2 negotiation assistant:** counter-language for selected findings in three tones, respecting the playbook fallback and walk-away points
- [ ] Exports: .docx with tracked-change-style redlines, a PDF risk report, CSV and JSON findings

**Exit criteria:** generated drafts score under 30 on the org's own playbook; a lawyer reviewer rates 80% of the counter-proposals usable with light edits; exported .docx files open correctly in Word and Google Docs.

### Phase 5 — Ask the contract and the obligations tracker (weeks 10–11)

**Goal:** make the clause store useful every day. **Builds on:** Phase 1 embeddings and Phase 2 clause types.

- [ ] Hybrid retrieval: pgvector similarity plus Postgres full-text search, merged with reciprocal rank fusion and filtered by contract or portfolio
- [ ] Chat UI with **Sonnet 5.5** streaming and inline clause citations; a "deep analysis" toggle routes to **Fable 5.2**
- [ ] Intent router with **Haiku 5.5**: a single-contract question, a portfolio question, or an analytics question (which becomes SQL over the findings)
- [ ] Obligation extraction with **Sonnet 5.5**: due dates, recurrence and notice windows, resolved against the effective date
- [ ] Calendar view, .ics export, and a daily Vercel Cron job that emails reminders through Resend at 30, 7 and 1 days before

**Exit criteria:** 90% of answers on a 100-question set cite the correct clause; obligation dates match the gold set at least 90% of the time; reminders fire in staging.

### Phase 6 — Collaboration, portfolio analytics and bulk scan (weeks 12–13)

**Goal:** a team product, not just a single-user tool. **Builds on:** everything above.

- [ ] Roles (admin, reviewer, viewer), assignment, contract status workflow (draft → in review → approved → signed), and threaded comments on findings
- [ ] Full audit trail of every accept, dismiss, edit and export
- [ ] Portfolio dashboard: risk distribution, top 10 recurring deviations, exposure by counterparty, renewals in the next 90 days
- [ ] Bulk scan: upload a zip of up to 200 files, run nightly with **Fable 5.2 through the Batch API**, email when done
- [ ] Per-org usage metering and token budgets in Upstash, with a usage page for admins

**Exit criteria:** a two-person review flow works end to end; a 100-contract bulk scan finishes overnight with no failed jobs; budget limits block calls once a budget runs out.

### Phase 7 — Hardening, evals and launch (weeks 14–15)

**Goal:** production quality and a public launch. **Builds on:** the complete feature set.

- [ ] Eval harness: gold sets from Phases 1–5 run in CI on every prompt or model change, with **Fable 5.2 as judge** for free-text quality; a PR fails if a metric regresses by more than 3 points
- [ ] Security pass: row-level security tests, prompt-injection tests (malicious text hidden in contracts), rate limits, file-type checks
- [ ] Performance: cache the analysis per file hash, tune the prompt cache, stream everything visible
- [ ] Privacy: data retention settings, delete-my-data, a data processing agreement page, and a note that the Anthropic API does not train on API data by default
- [ ] Landing page, docs, a demo org with sample contracts, and the legal disclaimer
- [ ] Load test with 50 concurrent analyses; set up on-call alerts

**Exit criteria:** all eval gates are green; there are no critical security issues; the p95 time to first finding is under 20 seconds; the app is live on a custom domain.

## Deployment on Vercel

Every push to a PR gets a Preview deploy with its own Neon database branch. A merge to `main` deploys to Production after migrations and eval gates pass. Choose a region close to your users and your database (for example `bom1`, Mumbai, for Indian customers).

### Setup steps

1. Push the repo to GitHub, then **Vercel → Add New Project → Import**, framework preset Next.js.
2. **Storage tab:** add Neon Postgres, Vercel Blob and Upstash Redis from the Marketplace. Their env vars are injected automatically.
3. **Integrations:** add Inngest, which sets up `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and syncs `/api/inngest`.
4. Add the remaining env vars (table below) for Production, Preview and Development; `vercel env pull` for local work.
5. Set the function region in `vercel.json` and raise `maxDuration` on the streaming routes (`/api/chat`, `/api/generate`) up to your plan's limit. Heavy work stays in Inngest jobs, not in request handlers.
6. Add `crons` to `vercel.json`: `/api/cron/reminders` daily at 03:30 UTC (09:00 IST), and `/api/cron/bulk-scan` nightly.
7. GitHub Actions on each PR: lint, typecheck, Vitest, `drizzle-kit migrate` against the preview branch, Playwright against the preview URL, and the eval suite on prompt changes.
8. Attach a custom domain and turn on Vercel Firewall rate-limit rules for `/api/*`.
9. Turn on Deployment Protection for Preview deploys, since they hold real model keys.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API access |
| `MODEL_TIER_REASONING` | `claude-fable-5-2` |
| `MODEL_TIER_REASONING_FALLBACK` | `claude-opus-5-5` |
| `MODEL_TIER_STANDARD` | `claude-sonnet-5-5` |
| `MODEL_TIER_FAST` | `claude-haiku-5-5` |
| `VOYAGE_API_KEY` | Embeddings |
| `DATABASE_URL` | Neon (auto-injected) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (auto-injected) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limits and budgets (auto-injected) |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Auth |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Jobs (auto-injected) |
| `RESEND_API_KEY` | Email |
| `CRON_SECRET` | Protects the cron routes |
| `SENTRY_DSN`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Observability |

### Repository layout

```
legalgpt/
  app/(marketing)/          landing, pricing, docs
  app/(app)/contracts/      list, [id] viewer, compare
  app/(app)/generate/       drafting wizard
  app/(app)/playbooks/      playbook editor
  app/(app)/compliance/     rule packs, policy builder
  app/(app)/analytics/      portfolio dashboard
  app/api/                  route handlers listed above
  lib/ai/                   router.ts, prompts/, schemas/ (Zod)
  lib/pipeline/             parse, segment, extract, embed, analyze, score
  lib/rules/                deterministic detectors + rule packs
  lib/db/                   drizzle schema, queries, RLS helpers
  inngest/                  job definitions
  evals/                    gold sets, runners, judge prompts
  tests/                    vitest + playwright
  vercel.json               regions, crons, function config
```

## Security, privacy, evaluation and testing

Contracts are confidential, so tenant isolation and prompt-injection defence are launch blockers, not polish. Model quality is gated in CI like any other test.

### Security and privacy

- **Tenant isolation:** Postgres row-level security on `org_id` for every table, with tests that try reading across orgs.
- **Prompt injection:** contract text always goes inside `<document>` tags with a system instruction to treat it as data. Model output is never executed, and the tool calls the model can make are limited to read-only retrieval.
- **Files:** check the MIME type and magic bytes, cap the size, use private Blob URLs with short-lived signed reads.
- **Secrets:** server-only env vars; no keys in client bundles (enforced by the `server-only` import).
- **Data handling:** a per-org retention period (30, 90 or 365 days, or forever), hard delete on request, and an audit log of every export.
- **Regulation for LegalGPT itself:** as a data fiduciary under India's DPDP Act and a processor under GDPR, publish a privacy notice and a DPA, and list Anthropic, Voyage, Neon and Vercel as subprocessors.
- **Disclaimer:** shown in the footer of every report, at the top of the chat, and in exports: "Not legal advice. Review findings with a qualified lawyer."

### Evaluation

| Eval set | Size | Metric | Gate |
| --- | --- | --- | --- |
| Clause segmentation | 30 contracts | Boundary F1, type accuracy | ≥ 0.95, ≥ 0.90 |
| Risk detection | 30 contracts, lawyer-labelled | High-severity recall and precision | ≥ 0.85, ≥ 0.75 |
| Compliance | 25 contracts | Verdict accuracy | ≥ 0.85 |
| Drafting | 20 requirement briefs | Playbook score, Fable judge rubric (1–5) | < 30, ≥ 4.0 |
| Ask the contract | 100 questions | Correct citation rate | ≥ 0.90 |
| Obligations | 40 contracts | Date exact-match rate | ≥ 0.90 |
| Injection | 25 poisoned contracts | Instruction-follow rate | 0 |

For gold data, start with public contract datasets such as CUAD (Contract Understanding Atticus Dataset) for clause labels, then add your own annotated Indian contracts. Recruiting a law student to label for a few hours a week is the cheapest way to get trustworthy labels.

### Testing

- **Unit (Vitest):** rule detectors, the scoring formula, the date resolver, diff alignment, and the router fallback (with a mocked 5xx).
- **Integration:** the full pipeline on 3 fixture contracts, with model calls recorded and replayed.
- **End to end (Playwright):** upload → findings → accept → export, generate → download, chat with a citation click.
- **Load:** 50 concurrent analyses with k6 before launch.

## Risks, costs and success metrics

The biggest risk is wrong findings that users trust. Citations, eval gates and human review are the controls for it. Model spend is the main variable cost, and it is kept down by routing, caching and batching.

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hallucinated or wrong findings | Users act on bad advice | Verbatim quote check, eval gates, a disclaimer, and human review of severity 4–5 findings |
| Fable 5.2 access interrupted | Reasoning features degrade | Fallback chain to Opus 5.5, a badge on fallback findings, re-run once Fable is back |
| Model spend grows faster than revenue | Negative margins | Haiku for extraction, prompt caching, clause batching, the Batch API for bulk work, per-org budgets |
| Poor parsing of scanned or badly formatted PDFs | Missed clauses | OCR fallback, a parse-confidence score, and a warning to the user below a threshold |
| Rule packs fall behind new laws | Stale compliance verdicts | Versioned packs, a review date on each pack, a changelog shown in the UI |
| Leak of confidential contracts | Legal and reputational damage | Row-level security, encryption at rest, signed URLs, an audit log, penetration test before launch |
| Long jobs time out | Failed analyses | All heavy work in Inngest steps with retries; request handlers only enqueue |

### Cost model

Track the cost of each contract from the `jobs` table from Phase 1 onward. Expect Fable 5.2 calls to make up most of the spend for each analysis, since they carry the reasoning. Check current per-token prices on Anthropic's pricing page before setting plan limits. Pricing tiers should include a monthly contract allowance with an overage rate, so heavy users pay for heavy use.

### Success metrics

| Metric | Target at launch |
| --- | --- |
| Time from upload to first finding (p95) | < 20 s |
| Full analysis of a 20-page contract (median) | < 90 s |
| High-severity risk recall | ≥ 85% |
| Findings accepted by reviewers | ≥ 60% |
| Weekly active orgs, 8 weeks after launch | 25 |
| Model cost as a share of revenue | < 30% |

### Next steps

- [ ] Pick Clerk or Auth.js, and Inngest or Vercel Workflow (both work; decide in Phase 0)
- [ ] Collect 30 sample contracts (NDAs, MSAs, SaaS terms) and find a labeller for the gold sets
- [ ] Start Phase 0 and get the empty app live on Vercel this week

Open question: which jurisdiction comes first? Choosing India puts the DPDP Act and Contract Act packs in Phase 3. Choosing the EU or US puts GDPR or CCPA first instead.
