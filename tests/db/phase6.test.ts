import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import JSZip from "jszip";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  exposureByCounterparty,
  riskDistribution,
  topRecurringFindings,
  upcomingRenewals,
} from "@/lib/analytics/portfolio";
import { BulkError, readArchive } from "@/lib/bulk/scan";
import {
  addComment,
  canTransition,
  listAudit,
  listComments,
  setWorkflow,
} from "@/lib/collab/workflow";
import { createContract, getContract } from "@/lib/contracts/queries";
import * as schema from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import { runAsOrg, type OrgTx } from "@/lib/db/tenant";
import { runAnalysis } from "@/lib/pipeline/analyze";
import {
  BudgetExceededError,
  assertWithinBudget,
  monthUsage,
  recordUsage,
  setBudget,
} from "@/lib/usage/budget";

import { EMPTY_EXTRACTION, fakeAi } from "../helpers/fake-ai";

const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });
const files = new Map<string, Uint8Array>();
let orgA: string;
let orgB: string;
let admin: User;
let reviewer: User;
let viewer: User;
let outsider: User;

const scopeFor =
  (orgId: string) =>
  <T>(fn: (tx: OrgTx) => Promise<T>) =>
    runAsOrg(db, orgId, fn);

async function analyse(
  orgId: string,
  by: User,
  fixture: string,
  extra: Partial<Parameters<typeof runAnalysis>[0]> = {},
) {
  const id = randomUUID();
  const key = `${orgId}/${id}/original.txt`;
  files.set(key, new Uint8Array(readFileSync(`tests/fixtures/contracts/${fixture}.txt`)));
  const created = await runAsOrg(db, orgId, (tx) =>
    createContract(tx, {
      id,
      orgId,
      createdBy: by.id,
      title: fixture,
      storageKey: key,
      fileName: `${fixture}.txt`,
      mimeType: "text/plain",
      sizeBytes: 1,
      fileHash: "t",
    }),
  );
  const result = await runAnalysis(
    {
      scope: scopeFor(orgId),
      readFile: async (k) => files.get(k)!,
      ai: fakeAi({
        extraction: {
          ...EMPTY_EXTRACTION,
          effectiveDate: {
            iso: new Date(Date.now() - 360 * 86_400_000).toISOString().slice(0, 10),
            quote: "entered into on 15 January 2026",
          },
          contractValue: {
            amount: 4800000,
            currency: "INR",
            description: "fees",
            quote: "INR 48,00,000 (Rupees Forty-Eight Lakh only)",
          },
        },
      }).ai,
      ...extra,
    },
    { contractId: id, jobId: created.job.id },
  );
  return { id, result };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const [a, b] = await db
    .insert(schema.orgs)
    .values([
      { clerkOrgId: "a", name: "Org A" },
      { clerkOrgId: "b", name: "Org B" },
    ])
    .returning();
  orgA = a.id;
  orgB = b.id;
  [admin, reviewer, viewer, outsider] = await db
    .insert(schema.users)
    .values([
      { orgId: orgA, clerkUserId: "u1", email: "admin@a.example", role: "admin" },
      { orgId: orgA, clerkUserId: "u2", email: "reviewer@a.example", role: "reviewer" },
      { orgId: orgA, clerkUserId: "u3", email: "viewer@a.example", role: "viewer" },
      { orgId: orgB, clerkUserId: "u4", email: "someone@b.example", role: "admin" },
    ])
    .returning();
});

describe("review workflow", () => {
  it("allows only the defined transitions, and requires a second person to approve", () => {
    const contract = {
      workflowStatus: "in_review",
      createdBy: reviewer.id,
      assigneeId: null,
    };
    expect(canTransition(contract, "approved", reviewer)).toMatchObject({
      ok: false,
      reason: /other than the person who uploaded/,
    });
    expect(canTransition(contract, "approved", admin)).toEqual({ ok: true });
    expect(canTransition(contract, "signed", admin)).toMatchObject({ ok: false });
    expect(canTransition(contract, "draft", reviewer)).toEqual({ ok: true });
    expect(canTransition(contract, "approved", viewer)).toMatchObject({ ok: false });
    expect(
      canTransition({ ...contract, workflowStatus: "approved" }, "signed", reviewer),
    ).toMatchObject({ ok: false, reason: /admin/ });
    expect(
      canTransition({ ...contract, workflowStatus: "signed" }, "in_review", admin),
    ).toMatchObject({ ok: false });
  });

  it("runs a two-person review end to end, with every step audited", async () => {
    // An admin uploads; the reviewer is assigned and approves; the admin signs.
    const { id } = await analyse(orgA, admin, "services-agreement");
    const step = (
      actor: User,
      change: {
        status?: "draft" | "in_review" | "approved" | "signed";
        assigneeId?: string | null;
      },
    ) =>
      runAsOrg(db, orgA, (tx) => setWorkflow(tx, { contractId: id, actor, ...change }));

    expect(await step(admin, { assigneeId: reviewer.id })).toMatchObject({
      assigneeId: reviewer.id,
    });
    expect(await step(admin, { status: "approved" })).toMatchObject({ status: 403 }); // uploader cannot approve
    expect(await step(reviewer, { status: "approved" })).toMatchObject({
      workflowStatus: "approved",
    });
    expect(await step(reviewer, { status: "signed" })).toMatchObject({ status: 403 }); // only an admin signs
    expect(await step(admin, { status: "signed" })).toMatchObject({
      workflowStatus: "signed",
    });

    // Assigning to a viewer or someone outside the org is refused.
    expect(await step(admin, { assigneeId: viewer.id })).toMatchObject({ status: 400 });
    expect(await step(admin, { assigneeId: outsider.id })).toMatchObject({ status: 400 });

    const trail = await runAsOrg(db, orgA, (tx) =>
      listAudit(tx, { target: `contract:${id}` }),
    );
    expect(trail.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "contract.uploaded",
        "contract.assigned",
        "contract.status_changed",
      ]),
    );
    expect(trail.filter((e) => e.action === "contract.status_changed")).toHaveLength(2);
  });

  it("threads comments on findings, visible only inside the organisation", async () => {
    const { id } = await analyse(orgA, admin, "employment-agreement");
    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, id));
    const finding = detail!.findings[0];

    await runAsOrg(db, orgA, (tx) =>
      addComment(tx, {
        findingId: finding.id,
        authorId: reviewer.id,
        body: "Is this enforceable?",
      }),
    );
    await runAsOrg(db, orgA, (tx) =>
      addComment(tx, { findingId: finding.id, authorId: admin.id, body: "No: s. 27." }),
    );

    const thread = await runAsOrg(db, orgA, (tx) => listComments(tx, id));
    expect(thread.map((c) => [c.author, c.body])).toEqual([
      ["reviewer@a.example", "Is this enforceable?"],
      ["admin@a.example", "No: s. 27."],
    ]);
    expect(await runAsOrg(db, orgB, (tx) => listComments(tx, id))).toEqual([]);
    expect(
      await runAsOrg(db, orgB, (tx) =>
        addComment(tx, { findingId: finding.id, authorId: outsider.id, body: "x" }),
      ),
    ).toBeNull();
  });
});

describe("usage and budgets", () => {
  it("counts analysis and other model use for the month", async () => {
    await runAsOrg(db, orgA, (tx) =>
      recordUsage(tx, {
        orgId: orgA,
        userId: admin.id,
        kind: "ask",
        usage: { tokensIn: 1000, tokensOut: 200 },
      }),
    );
    const usage = await runAsOrg(db, orgA, (tx) => monthUsage(tx));
    expect(usage.other.ask).toBe(1200);
    expect(usage.analysis).toBeGreaterThan(0);
    expect(usage.budget).toBeNull();
    // Another organisation's usage is separate.
    expect((await runAsOrg(db, orgB, (tx) => monthUsage(tx))).total).toBe(0);
  });

  it("blocks model calls once the budget is spent, leaving the rule-based review", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await runAsOrg(db, orgA, (tx) =>
      setBudget(tx, { orgId: orgA, budget: 1000, actorId: admin.id }),
    );
    await expect(runAsOrg(db, orgA, assertWithinBudget)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );

    const { ai, requests } = fakeAi();
    const { id, result } = await analyse(orgA, admin, "services-agreement", {
      ai,
      checkBudget: () => runAsOrg(db, orgA, assertWithinBudget),
    });

    expect(result).toMatchObject({ ok: false, stage: "classify" });
    expect(requests).toHaveLength(0); // no model call was made
    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, id));
    expect(detail!.job?.error).toMatch(/monthly AI budget is used up/);
    expect(detail!.contract.status).toBe("ready");
    expect(detail!.findings.length).toBeGreaterThan(5); // rules still ran

    await runAsOrg(db, orgA, (tx) =>
      setBudget(tx, { orgId: orgA, budget: null, actorId: admin.id }),
    );
    await expect(runAsOrg(db, orgA, assertWithinBudget)).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe("portfolio dashboard", () => {
  it("summarises risk, recurring issues, exposure and upcoming renewals", async () => {
    const distribution = await runAsOrg(db, orgA, riskDistribution);
    expect(distribution.scored).toBeGreaterThanOrEqual(3);
    expect(Object.values(distribution.bands).reduce((a, b) => a + b, 0)).toBe(
      distribution.scored,
    );

    const recurring = await runAsOrg(db, orgA, (tx) => topRecurringFindings(tx));
    expect(recurring.length).toBeGreaterThan(0);
    expect(
      recurring.find((r) => r.title === "Uncapped indemnity")?.contracts,
    ).toBeGreaterThanOrEqual(2);

    const exposure = await runAsOrg(db, orgA, (tx) => exposureByCounterparty(tx));
    expect(exposure[0].value).toBeGreaterThanOrEqual(4800000);

    // The services agreement started 360 days ago with a 3-year term, so no expiry within 90 days...
    const renewals = await runAsOrg(db, orgA, (tx) => upcomingRenewals(tx));
    expect(
      renewals.every((r) => r.kind === "expiry" || r.kind === "renewal_notice"),
    ).toBe(true);
    // ...and another organisation sees none of this.
    expect((await runAsOrg(db, orgB, riskDistribution)).scored).toBe(0);
  });
});

describe("bulk archives", () => {
  async function zip(entries: Record<string, string | Uint8Array>) {
    const archive = new JSZip();
    for (const [name, content] of Object.entries(entries)) archive.file(name, content);
    return archive.generateAsync({ type: "uint8array" });
  }

  it("keeps supported files and explains every one it skips", async () => {
    const { files: kept, skipped } = await readArchive(
      await zip({
        "contracts/nda.txt": "1. Term\nOne year.",
        "contracts/empty.txt": "",
        "contracts/photo.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
        "__MACOSX/._nda.txt": "junk",
        ".DS_Store": "junk",
      }),
    );
    expect(kept.map((f) => [f.name, f.kind])).toEqual([["nda.txt", "txt"]]);
    expect(skipped).toEqual([
      { name: "empty.txt", reason: "empty" },
      { name: "photo.jpg", reason: "not a PDF, Word or text file" },
    ]);
  });

  it("refuses something that is not a zip, an empty zip, and more than 200 files", async () => {
    await expect(
      readArchive(new TextEncoder().encode("not a zip")),
    ).rejects.toBeInstanceOf(BulkError);
    await expect(readArchive(await zip({}))).rejects.toThrow(/empty/);
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`c${i}.txt`, "x"]),
    );
    await expect(readArchive(await zip(many))).rejects.toThrow(/limit is 200/);
  });
});
