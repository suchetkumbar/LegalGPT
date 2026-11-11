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

## Phase 2 — Risk detection, scoring and clause analysis

Split into three sub-phases, each a commit point.

### 2a — Rule engine, findings, score, findings panel (built)

No model calls in this sub-phase.

| Plan item                                                               | Status                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Rule engine with 60+ deterministic detectors                            | Done: 83 detectors in 8 categories, each tested against its own examples                           |
| Scoring service using the plan's formula                                | Done, with the per-category breakdown                                                              |
| Category breakdown radar chart                                          | Shown as bars for now; the radar chart is in 2c                                                    |
| Findings panel: filter by severity, accept or dismiss, show in document | Built; not yet tried in a browser                                                                  |
| Default playbook, playbook editor                                       | 2b. Scoring uses built-in default weights until then                                               |
| Deviation analysis, risk judgment, executive summary                    | 2b                                                                                                 |
| Server-side quote check                                                 | Rule findings quote the clause by construction; the check for model findings comes with them in 2b |

Deviations:

- **Eight risk categories, not six.** The plan's six, plus "restrictions"
  (non-compete and exclusivity, which section 27 of the Contract Act treats
  specially) and "disputes" (governing law, seat, arbitrator appointment).
- **A finding that something is missing cites no clause.** "No limitation of
  liability clause" has nothing to quote. These have a null clause and quote, and
  the UI says so. Every other finding quotes its clause verbatim.
- **Rules are neutral about which side the organisation is on.** They flag
  one-sided terms without knowing whom they favour. The model pass in 2b, and a
  setting for "which party are we", will refine severity.
- **The review stage runs even if the model stages fail**, so a contract always
  gets its rule findings and score. Clauses the model could not type fall back to
  a type guessed from the heading.
- **A reviewer's accept or dismiss survives re-analysis**, matched by rule and
  quoted text.
- **Extra columns on `findings`:** `org_id`, `source`, `rule_id`, `title`,
  `clause_type`, `used_fallback`, `reviewed_by`, `reviewed_at`.

Observation on the score: with the plan's formula the denominator is the weight
of all 20 playbook clause types, so findings alone rarely push a contract past
"medium". The sample services agreement, written to be bad, reaches 70 only
because of the critical-finding floor. Worth revisiting once there is a labelled
set to tune against (2c).

### 2b — Playbook and model pass (built)

| Plan item                                                    | Status                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| Default playbook with standard positions for 20 clause types | Done; created per organisation on first use                    |
| Playbook editor UI                                           | Built at `/playbooks` (admin only); not yet tried in a browser |
| Deviation analysis against the playbook                      | Built, reasoning tier                                          |
| Risk judgment: severity and likelihood for each rule hit     | Built, same call                                               |
| Server-side quote check                                      | Done: a deviation whose quote is not in its clause is dropped  |
| Executive summary                                            | Built, same call                                               |

Deviations:

- **One model call, not three.** Deviation analysis, risk judgment and the
  summary share a single reasoning-tier request per contract, to stay inside a
  free quota (owner's instruction, 2026-11-11: keep calls minimal). The plan put
  the summary on the standard tier as its own call. A contract now costs four
  model calls in all: classify, extract, embed, assess.
- **Clauses are not batched by type.** The whole contract goes in one request,
  so the model sees interacting clauses together. Very long contracts are cut
  at 120,000 characters of clause text.
- **A rule finding is never deleted by the model.** If the model judges that it
  does not apply, the finding drops to severity 1 with the reason attached.
- **The score now uses the playbook's weights**, so editing a weight changes
  scores from the next analysis or review action.
- **No "which party are we" setting yet.** The review takes the organisation's
  side only when one party is recognisably the organisation; otherwise it judges
  one-sided terms neutrally. The setting moves to 2c.
- **Reasoning tier is `gemini-3.8-flash`**, the strongest free model, with
  low thinking and a four-minute limit per attempt.

Not yet verified against real Gemini: the one live call made for this sub-phase
(2026-11-11, medium thinking, two-minute limit) timed out without an answer. The
settings above were changed in response and have not been tried. If the call
keeps timing out, the options are a smaller request (fewer clauses per call) or
moving this step to `gemini-3.6-flash`. A failed judgment call leaves the
contract with its rule findings and score, and "Run analysis again" retries it.

### 2c — Evaluation and polish (built)

No model calls in this sub-phase.

| Plan item                         | Status                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Category breakdown radar chart    | Done (SVG, beside the category list on wide screens)                                                                           |
| "Which party are we" setting      | Done: `contracts.our_party`, chosen from the extracted parties; used by the judgment pass on the next analysis                 |
| Analysis cost per contract logged | Token counts are stored per job and shown on the contract page. Cost in rupees is zero on the free tier, so `cost_usd` stays 0 |
| Risk evaluation set               | Done as a generated set: `npm run eval:risk`                                                                                   |

### Phase 2 exit criteria

| Criterion                                                                                       | Result                                                                                                                                                                                                        | Status                                                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| High-severity recall at least 85%, precision at least 75%, on 30 contracts labelled by a lawyer | Rules only, on 30 generated contracts with 68 planted risks: recall 100%, precision 100%                                                                                                                      | Passes on the generated set. Not measured on lawyer-labelled contracts, which do not exist yet |
| Zero findings without a valid quote                                                             | Rule findings quote their clause by construction (tested on every detector). Model deviations are dropped unless the quote is found in the clause (tested). "Missing clause" findings have no quote by nature | Met, with the stated exception                                                                 |
| Median analysis cost per contract is logged                                                     | Tokens per job are stored and shown; no median report yet                                                                                                                                                     | Partly met                                                                                     |

How to read the risk numbers:

- The first run scored **74.7% recall** and 100% precision. Three planted risks
  were loose paraphrases the detectors did not recognise ("be more than" for a
  cap, "bring this Agreement to an end", "gives up any right to approach a
  court"). I widened those three patterns, which are sensible generalisations, and
  recall rose to 100%. A score reached by fixing the misses it revealed says the
  rules now cover this set, not that they will cover the next one.
- One planted risk, a one-sided right to terminate at will, was removed from the
  gold labels in contracts that already let either party leave on notice, where
  it is not a real risk.
- The contracts, the planted risks and the rules have the same author. Real
  contracts labelled by a lawyer remain the meaningful test.
- The judgment pass (deviations, re-scoring) is not evaluated at all: its one
  live call timed out, and it has not yet been seen to work against real Gemini.

### Open items carried forward (Phase 2)

- Confirm the judgment step works against real Gemini (see 2b).
- Risk evaluation on real, lawyer-labelled Indian contracts.
- The plan's score formula rarely exceeds "medium" without a critical finding;
  revisit once there are real scores to look at.
- A median cost report across contracts.

## Phase 3 — Compliance intelligence (built)

No model calls: compliance is checked deterministically.

| Plan item                                                             | Status                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Versioned rule packs as data, with applicability and legal references | Done: DPDP 2023 (8 rules), Indian Contract Act (4), Arbitration Act (2), stamp duty (1), GDPR Art. 28 (7), CCPA/CPRA (3) |
| Applicability step                                                    | Done, from the clauses, the text and the extracted governing law                                                         |
| Compliance reasoning with extended thinking, per rule                 | Changed: deterministic checks, see below                                                                                 |
| Internal policy builder                                               | Built at `/compliance` (admin only) as a form, not plain-English conversion                                              |
| Compliance tab with a matrix of rules against status                  | Built on the contract page; findings merged into the review list                                                         |

Deviations:

- **No model in compliance.** The plan had the reasoning model judge each rule
  with extended thinking. To keep within the free quota (owner's instruction:
  calls minimal), each rule instead checks for required and prohibited wording.
  This catches a missing breach-notification duty or a void non-compete; it
  cannot judge whether a clause that is present is good enough.
- **Policies are written as phrases, not converted from plain English.** An admin
  picks "must mention" or "must not mention", the phrases, the clause type and
  whether it fails or warns. No model is needed, so nothing waits on approval.
- **Compliance findings do not add to the risk score.** They restate risks the
  rule engine already scores (a void non-compete is both), so counting them twice
  would double the weight. They do appear in the findings list for review.
- **Rule packs live in code**, versioned; only organisation-written policies are
  stored (`rule_packs`). Every verdict stores the pack version it used
  (`compliance_results`).
- **DPDP applies only when personal data is processed**, not merely mentioned, so
  an NDA listing personal data as confidential information is not checked as a
  processing contract.

### Phase 3 exit criteria

| Criterion                                                | Result                                                             | Status       |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------ |
| Verdicts at least 85% accurate on a 25-contract gold set | Checked on the three sample contracts in tests; no 25-contract set | Not measured |
| Every verdict cites the rule pack version used           | Stored on every verdict and shown in the matrix                    | Met          |

### Open items carried forward (Phase 3)

- A 25-contract compliance gold set.
- Rule packs need review by a lawyer before anyone relies on them; the
  references were written from the statutes, not checked by counsel.

## Phase 4 — Generation, comparison and negotiation (built)

No automatic model calls. Two optional buttons use the model, one call per click.

| Plan item                                                                        | Status                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Template library: mutual and one-way NDA, MSA, SOW, SaaS, consulting, employment | Done: 7 templates as clause skeletons                                                                                                        |
| Generation wizard                                                                | Built at `/generate`. Drafts are assembled from the template and the organisation's playbook; "Adapt the draft with AI" is optional (1 call) |
| Self-check through the risk and compliance pipelines                             | Done on every draft, without saving it. Not regenerated automatically                                                                        |
| Version compare: alignment, word-level diff, favourable/neutral/unfavourable     | Built at `/contracts/:id/compare`. Classification by rule engine, not a model                                                                |
| Negotiation assistant in three tones                                             | Built at `/contracts/:id/negotiate`: playbook wording (free) or one AI call for all selected findings                                        |
| Exports: .docx redline, PDF risk report, CSV and JSON findings                   | Done; the PDF is the browser's "Save as PDF" of a print page                                                                                 |

Deviations:

- **Drafts are assembled, not written by the model.** Each clause is the
  playbook's standard position or fixed template wording. This costs nothing and
  is repeatable, but the drafting is only as good as the playbook. The model is
  used only when the drafter asks for changes.
- **No automatic regeneration of a high-scoring draft.** The self-check is shown
  instead. Every template scores under 30 on the default playbook (tested).
- **Change classification uses the rule engine**, not Sonnet. A change that adds
  a known risk pattern is unfavourable, one that removes one is favourable; any
  other change is shown as "changed". This misses changes the rules do not know.
- **Redlines are formatting marks** (red strike-through, blue underline), not
  Word's tracked changes.
- **PDF report via the browser's print dialog**, not `@react-pdf/renderer`, to
  avoid a large dependency.
- **A new version is uploaded from the contract page** and linked with
  `parent_id`; its `version` is one more than its parent's.
- **Exports are audited** (`contract.exported`).

### Phase 4 exit criteria

| Criterion                                                       | Result                                                                     | Status                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| Generated drafts score under 30 on the org's own playbook       | All 7 templates score under 30 with the default playbook (tested)          | Met for the default playbook |
| A lawyer rates 80% of counter-proposals usable with light edits | No lawyer review; the AI path has not been called live                     | Not measured                 |
| Exported .docx opens correctly in Word and Google Docs          | Valid Office Open XML produced (tested); not opened in Word or Google Docs | Not verified                 |

### Open items carried forward (Phase 4)

- Open an exported redline in Word and Google Docs.
- Try "Adapt the draft with AI" and "Draft with AI" live; both reuse the
  reasoning tier, which timed out once in Phase 2.
- Have a lawyer review the templates and default playbook wording.

## Phase 5 — Ask the contract and the obligations tracker (built)

Obligations and reminders use no model. Each question asked costs two calls.

| Plan item                                                                                      | Status                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hybrid retrieval: pgvector plus full-text, reciprocal rank fusion, contract or portfolio scope | Done (`lib/ask/retrieve.ts`), tested on the in-process database                                |
| Chat with inline clause citations; "deep analysis" uses the reasoning tier                     | Built on each contract page and on `/obligations` (whole portfolio). Answers are not streamed  |
| Intent router                                                                                  | Replaced by where the question is asked, see below                                             |
| Obligation extraction, resolved against the effective date                                     | Done by rules (`lib/obligations/extract.ts`)                                                   |
| Calendar view, .ics export, daily reminders at 30, 7 and 1 days                                | Built: `/obligations`, `/api/obligations?format=ics`, `/api/cron/reminders` daily at 09:00 IST |

Deviations:

- **No intent router.** A question asked on a contract page is about that
  contract; one asked on `/obligations` covers the whole portfolio. That saves a
  model call per question. Analytics questions answered by SQL are left to the
  Phase 6 portfolio dashboard.
- **Answers are returned whole, not streamed**, so every citation can be
  checked first. A citation is kept only if its quote is found in the clause it
  names; an answer with no verifiable citation is flagged.
- **Obligations are extracted by rules, not by Sonnet.** They cover expiry, the
  last day to stop an automatic renewal, end of probation, payment terms and
  termination notice. Conditional or unusual obligations ("within 10 days of each
  milestone") are not found. Months are added as calendar months, clamped to the
  end of the month.
- **Reminders go to the organisation's admins**, by Resend if `RESEND_API_KEY` is
  set and to the log otherwise. Resend's test sender only delivers to the account
  owner's address until a domain is verified.
- **The calendar is a month-by-month list**, not a grid.

### Phase 5 exit criteria

| Criterion                                                    | Result                                                                         | Status       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------ |
| 90% of answers on a 100-question set cite the correct clause | Citation checking is tested with a mocked model; no question set, no live call | Not measured |
| Obligation dates match a gold set at least 90% of the time   | Correct on the three sample contracts (tested); no 40-contract gold set        | Not measured |
| Reminders fire in staging                                    | The sweep and its schedule logic are tested; not run on a deployment           | Not verified |

### Open items carried forward (Phase 5)

- Ask a few questions live and check the citations.
- Deploy and confirm the cron runs (it needs `CRON_SECRET` set on Vercel).
- An obligations gold set with real effective dates and terms.
