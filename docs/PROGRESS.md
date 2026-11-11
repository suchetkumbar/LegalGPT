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

### Open items carried forward (Phase 0)

- Google uses free-tier Gemini content to improve its products. Real customer
  contracts must not go through it; moving to a paid tier is a launch blocker
  (Phase 7).
- Langfuse records model inputs and outputs. That is fine for the health ping, but
  before contract text flows through it (Phase 1) decide between masking,
  self-hosting, or metadata-only tracing.
- Clerk stores user accounts outside India. Note it in the DPDP subprocessor list
  (Phase 7).

## Phase 1 — Ingestion and the clause engine

Split into three sub-phases, each a commit point.

### 1a — Upload, parsing, rule-based segmentation, viewer (built)

No model calls in this sub-phase.

| Plan item                                      | Status                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Drag-and-drop upload (PDF, .docx, .txt; 20 MB) | Built; not yet tried in a browser                              |
| Parsing to plain text with character offsets   | Done, tested on all three formats                              |
| OCR fallback for scanned PDFs                  | Moved to 1c; scans are detected and reported for now           |
| `analyze` job with stages                      | `parse → segment` run after the upload response; Inngest in 1b |
| Segmentation: heading and numbering heuristics | Done, tested on three sample Indian contracts                  |
| Contract viewer with clause outline            | Built; not yet tried in a browser                              |
| SSE progress bar driven by the `jobs` table    | Built; not yet tried in a browser                              |

Deviations:

- **Uploads go through the server, not straight from the browser to Blob.** The
  server checks the file's real type from its bytes before anything is stored, and
  the same code path works locally. Vercel Functions accept bodies this size.
- **Without a Blob token, development stores files under `.data/`** (git-ignored).
  Production refuses to start an upload without Vercel Blob.
- **The viewer shows the extracted text, not the PDF page images.** Clause offsets
  index into that text, so highlights are exact for every file type.
- **Clause granularity is two levels** ("4.2"), with the parent heading carried
  down. Lettered items stay inside their clause.
- **`clauses.embedding` is 768 wide**, not 1024, to match `gemini-embedding-001`.
- **Extra columns:** `contracts.text`, `page_count`, `file_name`, `mime_type`,
  `size_bytes`, `file_hash`; `clauses.number`; `org_id` on `clauses` and `jobs`.

### 1b — Model pass (built, tested against a mocked model only)

| Plan item                                                               | Status                         |
| ----------------------------------------------------------------------- | ------------------------------ |
| Inngest `analyze` job, `parse → segment → classify → extract → embed`   | Built; not yet run on Inngest  |
| Fast model fixes boundaries and assigns one of 30 clause types          | Built; no live Gemini call yet |
| Entity extraction (parties, effective date, term, value, governing law) | Built; no live Gemini call yet |
| Embeddings into `clauses.embedding` with an HNSW index                  | Built; no live Gemini call yet |

Deviations:

- **Inngest is optional locally.** With no Inngest settings, the same stages run
  in the app's process after the response, without retries.
- **The model points at boundaries with quotes; it never rewrites text.** The
  server applies a merge or split only if the quoted words are in the clause.
- **The fast and standard tiers back each other up**, since free quotas are per
  model. The plan had a fallback chain only for the reasoning tier.
- **A failed model step leaves the contract readable** with its rule-based
  clauses, and a "Run analysis again" button (`POST /api/contracts/:id/analyze`).
- **`entities` has more kinds than the plan** (jurisdiction and term added), plus
  `label` and `normalized` columns.
- **Model traces never include contract text** (inputs and outputs are not
  recorded), which settles the Langfuse open item from Phase 0.
- **Calls per contract:** one classify call per 60 clauses, one extract call, one
  embedding call per 100 clauses. A typical contract uses three calls.

### 1c — OCR and evaluation

OCR for scanned PDFs; the 30-contract set for the exit criteria (boundaries ≥ 95%,
types ≥ 90%, a 20-page contract ingested in under 60 seconds).
