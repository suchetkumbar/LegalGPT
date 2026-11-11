import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createAnalysisJob,
  createContract,
  getContract,
  getLatestJob,
  listContracts,
} from "@/lib/contracts/queries";
import * as schema from "@/lib/db/schema";
import { runAsOrg, type OrgTx } from "@/lib/db/tenant";
import { runAnalysis } from "@/lib/pipeline/analyze";

import { makePdf } from "../helpers/documents";
import { fakeAi } from "../helpers/fake-ai";

const { orgs, users, clauses, entities, jobs, auditLog } = schema;
const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });

const files = new Map<string, Uint8Array>();
const readFile = async (key: string) => {
  const bytes = files.get(key);
  if (!bytes) throw new Error("missing file");
  return bytes;
};

let orgA: string;
let orgB: string;
let userA: string;
let userB: string;

const scopeFor =
  (orgId: string) =>
  <T>(fn: (tx: OrgTx) => Promise<T>) =>
    runAsOrg(db, orgId, fn);

async function upload(
  orgId: string,
  createdBy: string,
  fileName: string,
  bytes: Uint8Array,
) {
  const id = randomUUID();
  const storageKey = `${orgId}/${id}/${fileName}`;
  files.set(storageKey, bytes);
  const created = await runAsOrg(db, orgId, (tx) =>
    createContract(tx, {
      id,
      orgId,
      createdBy,
      title: fileName,
      storageKey,
      fileName,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      fileHash: "test",
    }),
  );
  return { contractId: created.contract.id, jobId: created.job.id };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const [a, b] = await db
    .insert(orgs)
    .values([
      { clerkOrgId: "org_a", name: "Org A" },
      { clerkOrgId: "org_b", name: "Org B" },
    ])
    .returning();
  orgA = a.id;
  orgB = b.id;
  const [ua, ub] = await db
    .insert(users)
    .values([
      { orgId: orgA, clerkUserId: "user_a", email: "a@example.com", role: "admin" },
      { orgId: orgB, clerkUserId: "user_b", email: "b@example.com", role: "admin" },
    ])
    .returning();
  userA = ua.id;
  userB = ub.id;
});

describe("analyze pipeline", () => {
  it("turns an uploaded contract into ordered clauses and marks it ready", async () => {
    const bytes = readFileSync("tests/fixtures/contracts/mutual-nda.txt");
    const ids = await upload(orgA, userA, "mutual-nda.txt", new Uint8Array(bytes));

    const queued = await runAsOrg(db, orgA, (tx) => getLatestJob(tx, ids.contractId));
    expect(queued).toMatchObject({ status: "queued", kind: "analyze" });

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi().ai },
      ids,
    );
    expect(result).toEqual({ ok: true });

    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, ids.contractId));
    expect(detail?.contract.status).toBe("ready");
    expect(detail?.job).toMatchObject({
      status: "succeeded",
      stage: "done",
      error: null,
    });
    expect(detail?.clauses).toHaveLength(21);
    expect(detail?.clauses.map((c) => c.ordinal)).toEqual([...Array(21).keys()]);

    // Stored offsets must index into the stored text.
    const text = detail!.contract.text!;
    const rows = await db
      .select()
      .from(clauses)
      .where(eq(clauses.contractId, ids.contractId));
    for (const row of rows) {
      expect(text.slice(row.startOffset, row.endOffset)).toBe(row.text);
    }
  });

  it("records the upload in the audit log", async () => {
    const entries = await db.select().from(auditLog).where(eq(auditLog.orgId, orgA));
    expect(entries.at(-1)).toMatchObject({
      action: "contract.uploaded",
      actorId: userA,
      diff: { fileName: "mutual-nda.txt" },
    });
  });

  it("does not duplicate clauses when the job runs again", async () => {
    const bytes = readFileSync("tests/fixtures/contracts/employment-agreement.txt");
    const ids = await upload(orgA, userA, "employment.txt", new Uint8Array(bytes));

    await runAnalysis({ scope: scopeFor(orgA), readFile, ai: fakeAi().ai }, ids);
    await runAnalysis({ scope: scopeFor(orgA), readFile, ai: fakeAi().ai }, ids);

    const rows = await db
      .select()
      .from(clauses)
      .where(eq(clauses.contractId, ids.contractId));
    expect(rows).toHaveLength(11);
  });

  it("fails a scanned PDF at the parse stage with a message for the user", async () => {
    const ids = await upload(orgA, userA, "scan.pdf", makePdf([""]));

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi().ai },
      ids,
    );
    expect(result).toMatchObject({ ok: false, stage: "parse" });

    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, ids.contractId));
    expect(detail?.contract.status).toBe("failed");
    expect(detail?.job).toMatchObject({ status: "failed", stage: "parse" });
    expect(detail?.job?.error).toMatch(/looks like a scan/);
    expect(detail?.clauses).toEqual([]);
  });

  it("hides internal errors from the user", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = await upload(orgA, userA, "lost.txt", new TextEncoder().encode("text"));
    files.clear();

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi().ai },
      ids,
    );

    expect(result).toEqual({
      ok: false,
      stage: "parse",
      error: "Something went wrong while processing this document.",
    });
    quiet.mockRestore();
  });

  it("lists contracts with clause counts, newest first, for the caller's org only", async () => {
    const bytes = new TextEncoder().encode("1. Term\nOne year.\n\n2. Fees\nMonthly.");
    const other = await upload(orgB, userB, "org-b-contract.txt", bytes);
    await runAnalysis({ scope: scopeFor(orgB), readFile, ai: fakeAi().ai }, other);

    const listA = await runAsOrg(db, orgA, listContracts);
    const listB = await runAsOrg(db, orgB, listContracts);

    expect(listB).toMatchObject([
      { title: "org-b-contract.txt", clauseCount: 2, status: "ready" },
    ]);
    expect(listA.map((c) => c.title)).not.toContain("org-b-contract.txt");
    expect(listA.find((c) => c.title === "mutual-nda.txt")?.clauseCount).toBe(21);

    // Asking for another org's contract by id finds nothing.
    expect(
      await runAsOrg(db, orgA, (tx) => getContract(tx, other.contractId)),
    ).toBeNull();
  });

  it("stores clause types, grounded entities, embeddings and token counts", async () => {
    const bytes = readFileSync("tests/fixtures/contracts/services-agreement.txt");
    const ids = await upload(orgA, userA, "services.txt", new Uint8Array(bytes));
    const { ai, embedded } = fakeAi({
      classify: (_, text) => ({
        type: /Limitation of Liability|liable|indemnify/.test(text)
          ? "limitation_of_liability"
          : "other",
      }),
      extraction: {
        contractType: "master_services_agreement",
        parties: [
          {
            name: "Narmada Retail Private Limited",
            role: "Client",
            quote: "Narmada Retail Private Limited, a company incorporated",
          },
          {
            name: "Tungabhadra Software Solutions Private Limited",
            role: "Service Provider",
            quote:
              "Tungabhadra Software Solutions Private Limited, a company incorporated",
          },
        ],
        effectiveDate: null,
        term: null,
        contractValue: {
          amount: 4800000,
          currency: "INR",
          description: "Fees under the first statement of work",
          quote: "INR 48,00,000 (Rupees Forty-Eight Lakh only)",
        },
        // Not in the contract: must be dropped.
        governingLaw: {
          value: "Laws of Singapore",
          quote: "governed by the laws of Singapore",
        },
        jurisdiction: null,
      },
    });

    const result = await runAnalysis({ scope: scopeFor(orgA), readFile, ai }, ids);
    expect(result).toEqual({ ok: true });

    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, ids.contractId));
    expect(detail?.contract).toMatchObject({
      status: "ready",
      type: "master_services_agreement",
      // The org is "Org A", which is neither party, so this is left for a person.
      counterparty: null,
    });
    expect(detail?.clauses.find((c) => c.number === "6.1")?.type).toBe(
      "limitation_of_liability",
    );
    expect(detail?.clauses.every((c) => c.type !== null)).toBe(true);

    // Entities: the invented governing law is gone; the amount points at clause 2.1.
    expect(detail?.entities.map((e) => e.kind).sort()).toEqual([
      "amount",
      "party",
      "party",
    ]);
    const amount = detail?.entities.find((e) => e.kind === "amount");
    expect(amount?.normalized).toEqual({ amount: 4800000, currency: "INR" });
    const feesClause = detail?.clauses.find((c) => c.number === "2.1");
    expect(amount?.clauseId).toBe(feesClause?.id);

    // Every clause has an embedding of the right width.
    const rows = await db
      .select()
      .from(clauses)
      .where(eq(clauses.contractId, ids.contractId));
    expect(rows).toHaveLength(25);
    expect(rows.every((row) => row.embedding?.length === 768)).toBe(true);
    expect(embedded[0]).toHaveLength(25);
    expect(embedded[0][13]).toMatch(/^Limitation of Liability\n/);

    // classify (100 in, 10 out) + extract (100 in, 10 out) + embed (25 x 5 in).
    expect(detail?.job).toMatchObject({
      tokensIn: 325,
      tokensOut: 20,
      status: "succeeded",
    });
  });

  it("completes when the provider reports no token count for embeddings", async () => {
    const bytes = new TextEncoder().encode("1. Term\nOne year.\n\n2. Fees\nMonthly.");
    const ids = await upload(orgA, userA, "no-usage.txt", bytes);

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi({ embedTokens: Number.NaN }).ai },
      ids,
    );

    expect(result).toEqual({ ok: true });
    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, ids.contractId));
    expect(detail?.job).toMatchObject({
      status: "succeeded",
      tokensIn: 200,
      tokensOut: 20,
    });
  });

  it("keeps the rule-based clauses usable when the model is unavailable", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = readFileSync("tests/fixtures/contracts/employment-agreement.txt");
    const ids = await upload(orgA, userA, "no-quota.txt", new Uint8Array(bytes));

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi({ failOn: "pipeline.classify" }).ai },
      ids,
    );

    expect(result).toMatchObject({ ok: false, stage: "classify" });
    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, ids.contractId));
    // Still readable: the clauses are there, just untyped.
    expect(detail?.contract.status).toBe("ready");
    expect(detail?.clauses).toHaveLength(11);
    expect(detail?.clauses.every((c) => c.type === null)).toBe(true);
    expect(detail?.job).toMatchObject({ status: "failed", stage: "classify" });
    expect(detail?.job?.error).toMatch(/free model quota/);
    // The raw provider error never reaches the user.
    expect(detail?.job?.error).not.toMatch(/quota exhausted/);
    quiet.mockRestore();
  });

  it("can be analysed again, replacing entities rather than adding to them", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new TextEncoder().encode(
      "AGREEMENT between Alpha Traders and Beta Mills.\n\n1. Term\nOne year.\n\n2. Law\nThis Agreement is governed by the laws of India.",
    );
    const ids = await upload(orgA, userA, "rerun.txt", bytes);
    const extraction = {
      contractType: "other" as const,
      parties: [],
      effectiveDate: null,
      term: null,
      contractValue: null,
      governingLaw: { value: "Laws of India", quote: "governed by the laws of India" },
      jurisdiction: null,
    };

    // First run fails at the embedding stage, after entities were saved.
    await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi({ extraction, failOn: "embed" }).ai },
      ids,
    );

    const again = await runAsOrg(db, orgA, (tx) =>
      createAnalysisJob(tx, { contractId: ids.contractId, actorId: userA }),
    );
    if (typeof again === "string") throw new Error(`expected a job, got ${again}`);

    // A second request while that job is waiting is refused.
    expect(
      await runAsOrg(db, orgA, (tx) =>
        createAnalysisJob(tx, { contractId: ids.contractId, actorId: userA }),
      ),
    ).toBe("busy");

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi({ extraction }).ai },
      { contractId: ids.contractId, jobId: again.id },
    );
    expect(result).toEqual({ ok: true });

    const found = await db
      .select()
      .from(entities)
      .where(eq(entities.contractId, ids.contractId));
    expect(found.map((e) => e.value)).toEqual(["Laws of India"]);
    const allJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.contractId, ids.contractId));
    expect(allJobs.map((j) => j.status).sort()).toEqual(["failed", "succeeded"]);
    quiet.mockRestore();
  });

  it("refuses to re-analyse another org's contract", async () => {
    const bytes = new TextEncoder().encode("1. Term\nOne year.");
    const ids = await upload(orgB, userB, "theirs.txt", bytes);
    expect(
      await runAsOrg(db, orgA, (tx) =>
        createAnalysisJob(tx, { contractId: ids.contractId, actorId: userA }),
      ),
    ).toBe("not-found");
  });

  it("cannot run another org's job", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new TextEncoder().encode("1. Term\nOne year.");
    const ids = await upload(orgB, userB, "private.txt", bytes);

    const result = await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi().ai },
      ids,
    );
    expect(result.ok).toBe(false);

    const detail = await runAsOrg(db, orgB, (tx) => getContract(tx, ids.contractId));
    expect(detail?.contract.status).toBe("uploaded");
    expect(detail?.job?.status).toBe("queued");
    quiet.mockRestore();
  });
});
