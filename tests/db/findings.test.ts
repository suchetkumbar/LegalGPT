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
  listContracts,
  setFindingStatus,
  setOurParty,
} from "@/lib/contracts/queries";
import * as schema from "@/lib/db/schema";
import { runAsOrg, type OrgTx } from "@/lib/db/tenant";
import { runAnalysis } from "@/lib/pipeline/analyze";
import {
  addPolicy,
  getComplianceResults,
  listPolicies,
  removePolicy,
} from "@/lib/compliance/store";

import { EMPTY_EXTRACTION, fakeAi } from "../helpers/fake-ai";

const { orgs, users, auditLog, findings } = schema;
const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });

const files = new Map<string, Uint8Array>();
const readFile = async (key: string) => files.get(key)!;

let orgA: string;
let orgB: string;
let userA: string;
let userB: string;

const scopeFor =
  (orgId: string) =>
  <T>(fn: (tx: OrgTx) => Promise<T>) =>
    runAsOrg(db, orgId, fn);

async function analyse(orgId: string, userId: string, fixture: string, ai = fakeAi().ai) {
  const id = randomUUID();
  const storageKey = `${orgId}/${id}/original.txt`;
  files.set(
    storageKey,
    new Uint8Array(readFileSync(`tests/fixtures/contracts/${fixture}.txt`)),
  );
  const created = await runAsOrg(db, orgId, (tx) =>
    createContract(tx, {
      id,
      orgId,
      createdBy: userId,
      title: fixture,
      storageKey,
      fileName: `${fixture}.txt`,
      mimeType: "text/plain",
      sizeBytes: 1,
      fileHash: "test",
    }),
  );
  const result = await runAnalysis(
    { scope: scopeFor(orgId), readFile, ai },
    { contractId: id, jobId: created.job.id },
  );
  return { contractId: id, result };
}

const detailOf = (orgId: string, contractId: string) =>
  runAsOrg(db, orgId, (tx) => getContract(tx, contractId));

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

describe("review stage", () => {
  it("stores rule findings against their clauses and scores the contract", async () => {
    const { contractId, result } = await analyse(orgA, userA, "services-agreement");
    expect(result).toEqual({ ok: true });

    const detail = await detailOf(orgA, contractId);
    const found = detail!.findings;

    expect(found.length).toBeGreaterThanOrEqual(13);
    expect(found.every((f) => f.source === "rule")).toBe(true);
    expect(found.every((f) => f.kind === "risk" || f.kind === "compliance")).toBe(true);
    // The void non-compete is also a compliance failure under s. 27.
    expect(
      found.some(
        (f) => f.kind === "compliance" && f.ruleId === "ica.s27-restraint-of-trade",
      ),
    ).toBe(true);
    expect(found.every((f) => f.status === "open")).toBe(true);
    // Most serious first.
    expect(found[0]).toMatchObject({
      ruleId: "liability.uncapped-indemnity",
      severity: 5,
    });

    // Every quote is in the clause the finding points at.
    const text = detail!.contract.text!;
    for (const finding of found) {
      if (finding.quotedText === null) {
        expect(finding.clauseId).toBeNull();
        continue;
      }
      const clause = detail!.clauses.find((c) => c.id === finding.clauseId);
      expect(clause).toBeDefined();
      expect(text.slice(clause!.startOffset, clause!.endOffset)).toContain(
        finding.quotedText,
      );
    }

    // The uncapped indemnity is critical, so the floor of 70 applies.
    expect(detail!.contract.riskScore).toBe(70);
    const list = await runAsOrg(db, orgA, listContracts);
    expect(list.find((c) => c.id === contractId)?.riskScore).toBe(70);
  });

  it("scores a balanced NDA low", async () => {
    const { contractId } = await analyse(
      orgA,
      userA,
      "mutual-nda",
      fakeAi({ extraction: { ...EMPTY_EXTRACTION, contractType: "nda" } }).ai,
    );
    const detail = await detailOf(orgA, contractId);

    expect(detail!.contract.riskScore).toBeLessThan(30);
    expect(detail!.findings.filter((f) => f.severity >= 4)).toEqual([]);
    expect(detail!.findings.filter((f) => f.kind === "compliance")).toEqual([]);
  });

  it("still produces findings and a score when the model is unavailable", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { contractId, result } = await analyse(
      orgA,
      userA,
      "services-agreement",
      fakeAi({ failOn: "pipeline.classify" }).ai,
    );

    // The job reports the model failure, at the stage that failed...
    expect(result).toMatchObject({ ok: false, stage: "classify" });
    const detail = await detailOf(orgA, contractId);
    expect(detail!.job).toMatchObject({ status: "failed", stage: "classify" });
    // ...but the rules ran on heading-based types, so the review is still there.
    expect(detail!.contract.status).toBe("ready");
    expect(detail!.findings.map((f) => f.ruleId)).toEqual(
      expect.arrayContaining([
        "liability.uncapped-indemnity",
        "payment.long-terms",
        "termination.unilateral-convenience",
      ]),
    );
    expect(detail!.contract.riskScore).toBe(70);
    quiet.mockRestore();
  });
});

describe("reviewing findings", () => {
  it("dismissing the critical finding lowers the score, reopening restores it", async () => {
    const { contractId } = await analyse(orgA, userA, "services-agreement");
    const before = await detailOf(orgA, contractId);
    const critical = before!.findings.find(
      (f) => f.ruleId === "liability.uncapped-indemnity",
    )!;

    const dismissed = await runAsOrg(db, orgA, (tx) =>
      setFindingStatus(tx, {
        findingId: critical.id,
        status: "dismissed",
        actorId: userA,
      }),
    );
    expect(dismissed?.finding).toMatchObject({ status: "dismissed", reviewedBy: userA });
    expect(dismissed!.riskScore).toBeLessThan(70);
    expect((await detailOf(orgA, contractId))!.contract.riskScore).toBe(
      dismissed!.riskScore,
    );

    const reopened = await runAsOrg(db, orgA, (tx) =>
      setFindingStatus(tx, { findingId: critical.id, status: "open", actorId: userA }),
    );
    expect(reopened?.finding).toMatchObject({ status: "open", reviewedBy: null });
    expect(reopened!.riskScore).toBe(70);
  });

  it("accepting a finding keeps it in the score and records who decided", async () => {
    const { contractId } = await analyse(orgA, userA, "employment-agreement");
    const before = await detailOf(orgA, contractId);
    const target = before!.findings[0];

    const accepted = await runAsOrg(db, orgA, (tx) =>
      setFindingStatus(tx, { findingId: target.id, status: "accepted", actorId: userA }),
    );

    expect(accepted!.riskScore).toBe(before!.contract.riskScore);
    const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, orgA));
    expect(audit.at(-1)).toMatchObject({
      action: "finding.accepted",
      actorId: userA,
      target: `finding:${target.id}`,
      diff: { status: ["open", "accepted"] },
    });
  });

  it("keeps a reviewer's decisions when the contract is analysed again", async () => {
    const { contractId } = await analyse(orgA, userA, "services-agreement");
    const before = await detailOf(orgA, contractId);
    const dismissedRule = "termination.long-cure-period";
    const target = before!.findings.find((f) => f.ruleId === dismissedRule)!;
    await runAsOrg(db, orgA, (tx) =>
      setFindingStatus(tx, { findingId: target.id, status: "dismissed", actorId: userA }),
    );

    const job = await runAsOrg(db, orgA, (tx) =>
      createAnalysisJob(tx, { contractId, actorId: userA }),
    );
    if (typeof job === "string") throw new Error(job);
    await runAnalysis(
      { scope: scopeFor(orgA), readFile, ai: fakeAi().ai },
      { contractId, jobId: job.id },
    );

    const after = await detailOf(orgA, contractId);
    // Same findings, not duplicates.
    expect(after!.findings).toHaveLength(before!.findings.length);
    expect(after!.findings.find((f) => f.ruleId === dismissedRule)?.status).toBe(
      "dismissed",
    );
    expect(after!.findings.filter((f) => f.status === "dismissed")).toHaveLength(1);
  });

  it("records which party the organisation is, and only accepts a real party", async () => {
    const parties = [
      "Narmada Retail Private Limited",
      "Tungabhadra Software Solutions Private Limited",
    ];
    const { contractId } = await analyse(
      orgA,
      userA,
      "services-agreement",
      fakeAi({
        extraction: {
          ...EMPTY_EXTRACTION,
          contractType: "master_services_agreement",
          parties: parties.map((name) => ({
            name,
            role: null,
            quote: `${name}, a company incorporated`,
          })),
        },
      }).ai,
    );
    const set = (ourParty: string | null, orgId = orgA) =>
      runAsOrg(db, orgId, (tx) =>
        setOurParty(tx, { contractId, ourParty, actorId: userA }),
      );

    expect(await set("Somebody Else Limited")).toBe("not-a-party");
    expect(await set(parties[0], orgB)).toBe("not-found");

    const updated = await set(parties[0]);
    expect(updated).toMatchObject({ ourParty: parties[0], counterparty: parties[1] });
    expect(await set(null)).toMatchObject({ ourParty: null });
  });

  it("stores compliance verdicts with their pack version, and applies internal policies", async () => {
    const policy = await runAsOrg(db, orgA, (tx) =>
      addPolicy(tx, {
        orgId: orgA,
        actorId: userA,
        policy: {
          title: "No auto-renewal",
          description: "We do not sign contracts that renew themselves.",
          mode: "forbid",
          phrases: ["renew automatically"],
          clauseType: null,
          severity: "fail",
          category: "renewal",
          fix: "",
        },
      }),
    );
    expect((await runAsOrg(db, orgA, listPolicies)).version).toBe(1);
    // Another organisation does not see it.
    expect((await runAsOrg(db, orgB, listPolicies)).rules).toEqual([]);

    const { contractId } = await analyse(orgA, userA, "services-agreement");
    const results = await runAsOrg(db, orgA, (tx) =>
      getComplianceResults(tx, contractId),
    );

    const byRule = Object.fromEntries(results.map((r) => [r.ruleId, r]));
    expect(byRule["ica.s27-restraint-of-trade"]).toMatchObject({
      verdict: "fail",
      packCode: "ICA",
      packVersion: "2026.1",
    });
    expect(byRule["ica.s27-restraint-of-trade"].clauseId).not.toBeNull();
    expect(byRule[policy.id]).toMatchObject({
      verdict: "fail",
      packCode: "INTERNAL",
      packVersion: "1",
    });

    // Compliance findings are listed for review but do not move the score.
    const detail = await detailOf(orgA, contractId);
    expect(
      detail!.findings.some((f) => f.kind === "compliance" && f.ruleId === policy.id),
    ).toBe(true);
    expect(detail!.contract.riskScore).toBe(70);

    expect(
      await runAsOrg(db, orgA, (tx) =>
        removePolicy(tx, { orgId: orgA, actorId: userA, ruleId: policy.id }),
      ),
    ).toBe(true);
    expect(await runAsOrg(db, orgA, listPolicies)).toMatchObject({
      version: 2,
      rules: [],
    });
  });

  it("cannot see or change another org's findings", async () => {
    const { contractId } = await analyse(orgB, userB, "services-agreement");
    const theirs = (await detailOf(orgB, contractId))!.findings[0];

    expect(await detailOf(orgA, contractId)).toBeNull();
    const result = await runAsOrg(db, orgA, (tx) =>
      setFindingStatus(tx, { findingId: theirs.id, status: "dismissed", actorId: userA }),
    );
    expect(result).toBeNull();

    const [unchanged] = await db
      .select()
      .from(findings)
      .where(eq(findings.id, theirs.id));
    expect(unchanged.status).toBe("open");
  });
});
