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

### 1c — OCR and evaluation (built; live evaluation only partly run)

| Plan item                     | Status                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| OCR fallback for scanned PDFs | Done with Tesseract inside the app; tested locally on an image-only PDF. Not yet verified on Vercel |
| 30-contract test set          | Done: generated Indian-style contracts with exact gold labels (`evals/generator`)                   |
| Evaluation harness            | Done: `npm run eval:segmentation` (rules only) and `-- --model` (adds Gemini)                       |

Owner decisions (2026-11-11): OCR with Tesseract in the app rather than Gemini;
evaluation on generated contracts rather than real ones; live evaluation stopped
after the first failed call.

How the evaluation set is built: 30 contracts composed from a hand-typed clause
library, three in each of ten numbering styles. Twenty are clean. Ten carry the
damage PDF extraction causes: clauses run together on one line, a clause number
split from its heading, and page headers and footers in the text.

Rule changes the evaluation led to: `1)` and `(1)` numbering; recitals and
signature blocks in unnumbered contracts; a clause number alone on a line with its
heading on the next; recovery when several headings in a row are lost; sub-clauses
whose parent heading is lost.

Deviations:

- **OCR is English only** and capped at 40 pages per scan. A contract read by OCR
  is flagged (`contracts.ocr_used`) and the viewer says so.
- **The evaluation set is generated, not real contracts.** It measures how the
  pipeline copes with formatting variety and extraction damage. It says little
  about real drafting, and the clean score is weak evidence because the contracts
  and the rules have the same author.

### Phase 1 exit criteria

| Criterion                                                 | Result                                                                                                                                    | Status                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Clause boundaries at least 95% correct on 30 contracts    | Rules only, all 30: F1 96.6% (clean 100%, noisy 89.5%). Rules + Gemini: 99.6% on the 4 contracts scored before the run stopped            | Rules-only figure passes; the full rules + model figure is not measured |
| Type labels at least 90% correct                          | 99.1% on 4 contracts (115 clauses; one disagreement, taxes labelled as payment)                                                           | Not measured on the full set                                            |
| A 20-page contract finishes ingestion in under 60 seconds | Parsing and segmentation take a few milliseconds. In the 1b live test, typing 25 clauses took 4.1 s, extraction 2.7 s and embedding 2.3 s | Not measured on a 20-page contract                                      |

To finish the measurement: `npm run eval:segmentation -- --model --delay 15000`.
It makes one Gemini call per contract not already cached (26 remain), stops at
the first failure and prints the provider's error. The fifth call of the first
run failed for a reason that was not recorded; a free-tier per-minute limit is
suspected, not confirmed.

### Open items carried forward (Phase 1)

- Finish the live evaluation and the 20-page timing (above).
- Confirm OCR works on Vercel: it relies on a native canvas module and on files
  the build is told to include (`next.config.ts`), which only a deploy can prove.
- Add real, hand-labelled Indian contracts to the evaluation set.
- Hindi OCR needs the Hindi language data package.
