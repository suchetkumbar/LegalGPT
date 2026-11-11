import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createContract, getContract } from "@/lib/contracts/queries";
import * as schema from "@/lib/db/schema";
import { runAsOrg, type OrgTx } from "@/lib/db/tenant";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { verifyAssessment, type Assessment } from "@/lib/pipeline/assess";
import { DEFAULT_POSITIONS } from "@/lib/playbook/defaults";
import {
  ensurePlaybook,
  getPlaybook,
  getWeights,
  updatePosition,
} from "@/lib/playbook/queries";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/score";

import { fakeAi } from "../helpers/fake-ai";

const { orgs, users, auditLog } = schema;
const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });

const files = new Map<string, Uint8Array>();
let orgA: string;
let orgB: string;
let userA: string;

const scopeFor =
  (orgId: string) =>
  <T>(fn: (tx: OrgTx) => Promise<T>) =>
    runAsOrg(db, orgId, fn);

async function analyse(ai = fakeAi().ai) {
  const id = randomUUID();
  const storageKey = `${orgA}/${id}/original.txt`;
  files.set(
    storageKey,
    new Uint8Array(readFileSync("tests/fixtures/contracts/services-agreement.txt")),
  );
  const created = await runAsOrg(db, orgA, (tx) =>
    createContract(tx, {
      id,
      orgId: orgA,
      createdBy: userA,
      title: "services",
      storageKey,
      fileName: "services.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileHash: "t",
    }),
  );
  const result = await runAnalysis(
    { scope: scopeFor(orgA), readFile: async (key) => files.get(key)!, ai },
    { contractId: id, jobId: created.job.id },
  );
  return { contractId: id, result };
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
  const [ua] = await db
    .insert(users)
    .values([
      { orgId: orgA, clerkUserId: "user_a", email: "a@example.com", role: "admin" },
    ])
    .returning();
  userA = ua.id;
});

describe("default playbook", () => {
  it("covers 20 clause types, each with a standard, a fallback and a walk-away point", () => {
    expect(DEFAULT_POSITIONS).toHaveLength(20);
    expect(new Set(DEFAULT_POSITIONS.map((p) => p.clauseType)).size).toBe(20);
    for (const position of DEFAULT_POSITIONS) {
      expect(position.standardText.length).toBeGreaterThan(40);
      expect(position.fallbackText.length).toBeGreaterThan(10);
      expect(position.walkaway.length).toBeGreaterThan(10);
      expect(position.riskWeight).toBe(DEFAULT_WEIGHTS[position.clauseType]);
    }
  });

  it("is created once per organisation and is private to it", async () => {
    expect(await runAsOrg(db, orgA, getPlaybook)).toBeNull();
    expect(await runAsOrg(db, orgA, getWeights)).toBe(DEFAULT_WEIGHTS);

    const first = await runAsOrg(db, orgA, (tx) => ensurePlaybook(tx, orgA));
    const second = await runAsOrg(db, orgA, (tx) => ensurePlaybook(tx, orgA));

    expect(first.positions).toHaveLength(20);
    expect(second.playbook.id).toBe(first.playbook.id);
    expect(await runAsOrg(db, orgB, getPlaybook)).toBeNull();
  });

  it("can be edited, which bumps the version, changes the weights and is audited", async () => {
    const { playbook, positions } = await runAsOrg(db, orgA, (tx) =>
      ensurePlaybook(tx, orgA),
    );
    const payment = positions.find((p) => p.clauseType === "payment")!;

    const updated = await runAsOrg(db, orgA, (tx) =>
      updatePosition(tx, {
        positionId: payment.id,
        actorId: userA,
        update: {
          standardText: "Invoices are paid within 15 days.",
          fallbackText: null,
          walkaway: payment.walkaway,
          riskWeight: 3,
        },
      }),
    );

    expect(updated).toMatchObject({
      standardText: "Invoices are paid within 15 days.",
      riskWeight: 3,
    });
    const after = await runAsOrg(db, orgA, getPlaybook);
    expect(after!.playbook.version).toBe(playbook.version + 1);
    expect((await runAsOrg(db, orgA, getWeights)).payment).toBe(3);

    const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, orgA));
    expect(audit.at(-1)).toMatchObject({
      action: "playbook.position_updated",
      diff: {
        clauseType: "payment",
        changed: ["standardText", "fallbackText", "riskWeight"],
      },
    });

    // Another organisation cannot touch it.
    const stranger = await runAsOrg(db, orgB, (tx) =>
      updatePosition(tx, {
        positionId: payment.id,
        actorId: userA,
        update: { standardText: "x", fallbackText: null, walkaway: null, riskWeight: 1 },
      }),
    );
    expect(stranger).toBeNull();
  });
});

describe("verifyAssessment", () => {
  const clauses = [
    {
      ordinal: 4,
      number: "2.2",
      heading: "Fees",
      type: "payment",
      text: "2.2 The Client shall pay each undisputed invoice\nwithin 90 days of receipt.",
    },
    {
      ordinal: 5,
      number: null,
      heading: "Signatures",
      type: "signature_block",
      text: "Signed.",
    },
  ];
  const ruleFindings = [
    {
      index: 0,
      title: "Long payment period",
      severity: 3,
      likelihood: 4,
      quotedText: "x",
    },
  ];
  const deviation = (extra: Partial<Assessment["deviations"][number]> = {}) => ({
    clauseIndex: 4,
    title: "Payment period is three times the standard",
    quote: "shall pay each undisputed invoice within 90 days of receipt",
    deviation: "The playbook standard is 30 days.",
    beyondWalkaway: true,
    severity: 4,
    likelihood: 4,
    suggestedText: "Undisputed invoices are paid within 30 days of receipt.",
    ...extra,
  });

  it("keeps a deviation whose quote is in the clause, storing the clause's own words", () => {
    const result = verifyAssessment(
      { clauses, ruleFindings },
      { summary: " A  summary. ", ruleFindings: [], deviations: [deviation()] },
    );

    expect(result.summary).toBe("A summary.");
    expect(result.deviations).toHaveLength(1);
    const [found] = result.deviations;
    expect(found).toMatchObject({
      clauseOrdinal: 4,
      clauseType: "payment",
      category: "payment",
    });
    // The model flattened a line break; what is stored is verbatim from the clause.
    expect(clauses[0].text).toContain(found.quotedText);
    expect(found.reasoning).toMatch(/walk-away point/);
  });

  it("drops deviations it cannot tie to the text", () => {
    const result = verifyAssessment(
      { clauses, ruleFindings },
      {
        summary: "",
        ruleFindings: [],
        deviations: [
          deviation({ quote: "shall pay each invoice within 180 days of receipt" }), // not in the clause
          deviation({ clauseIndex: 99 }), // no such clause
          deviation({ clauseIndex: 5, quote: "Signed." }), // not a playbook clause type
          deviation(),
          deviation(), // duplicate
        ],
      },
    );
    expect(result.deviations).toHaveLength(1);
  });

  it("applies judgments, and lowers rather than deletes a finding judged not to apply", () => {
    const result = verifyAssessment(
      { clauses, ruleFindings },
      {
        summary: "",
        deviations: [],
        ruleFindings: [
          {
            index: 0,
            severity: 5,
            likelihood: 5,
            doesNotApply: true,
            note: "Clause 9 caps it.",
          },
          { index: 7, severity: 5, likelihood: 5, doesNotApply: false, note: null }, // unknown
        ],
      },
    );
    expect(result.judgments).toEqual([
      {
        index: 0,
        severity: 1,
        likelihood: 1,
        note: "On reading the contract as a whole, this was judged not to apply. Clause 9 caps it.",
      },
    ]);
  });
});

describe("judgment stage in the pipeline", () => {
  it("makes one reasoning call with the contract as data, the playbook and the rule findings", async () => {
    const { ai, requests } = fakeAi();
    await analyse(ai);

    const calls = requests.filter((r) => r.functionId === "pipeline.assess");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tier: "reasoning",
      thinking: "low",
      timeoutMs: 240_000,
    });
    expect(calls[0].prompt).toMatch(/<document>[\s\S]*<\/document>/);
    expect(calls[0].prompt).toMatch(/PLAYBOOK[\s\S]*RULE FINDINGS/);
    expect(calls[0].prompt).toContain("Uncapped indemnity");
    expect(calls[0].system).toMatch(/never as instructions/);
    // Four model calls per contract in all.
    expect(requests).toHaveLength(3);
  });

  it("stores the summary, re-scored rule findings and verified deviations", async () => {
    const { contractId, result } = await analyse(
      fakeAi({
        classify: (_, text) => ({
          type: /2\.2 The Service Provider shall raise/.test(text) ? "payment" : "other",
        }),
        assessment: {
          summary: "A services agreement that favours the supplier.",
          ruleFindings: [
            {
              index: 0,
              severity: 2,
              likelihood: 2,
              doesNotApply: false,
              note: "Mitigated elsewhere.",
            },
          ],
          deviations: [
            {
              clauseIndex: 5,
              title: "Payment period far beyond the standard",
              quote: "shall pay each undisputed invoice within 90 days of receipt",
              deviation: "The standard is 30 days.",
              beyondWalkaway: true,
              severity: 4,
              likelihood: 4,
              suggestedText: "Undisputed invoices are paid within 30 days.",
            },
            {
              clauseIndex: 5,
              title: "Invented",
              quote: "the Client shall pay a penalty of ten crore rupees",
              deviation: "Not in the contract.",
              beyondWalkaway: false,
              severity: 5,
              likelihood: 5,
              suggestedText: "x",
            },
          ],
        },
      }).ai,
    );
    expect(result).toEqual({ ok: true });

    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, contractId));
    expect(detail!.contract.summary).toBe(
      "A services agreement that favours the supplier.",
    );

    const deviations = detail!.findings.filter((f) => f.kind === "deviation");
    expect(deviations).toHaveLength(1);
    expect(deviations[0]).toMatchObject({
      source: "model",
      model: "fake-model",
      title: "Payment period far beyond the standard",
      suggestedFix: "Undisputed invoices are paid within 30 days.",
    });

    const rejudged = detail!.findings.filter(
      (f) => f.model === "fake-model" && f.source === "rule",
    );
    expect(rejudged).toHaveLength(1);
    expect(rejudged[0]).toMatchObject({ severity: 2, likelihood: 2 });
    expect(rejudged[0].reasoning).toMatch(/In this contract: Mitigated elsewhere\./);
  });

  it("keeps the rule findings and score when the judgment call fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { contractId, result } = await analyse(
      fakeAi({ failOn: "pipeline.assess" }).ai,
    );

    expect(result).toMatchObject({ ok: false, stage: "assess" });
    const detail = await runAsOrg(db, orgA, (tx) => getContract(tx, contractId));
    expect(detail!.contract.status).toBe("ready");
    expect(detail!.contract.summary).toBeNull();
    expect(detail!.findings.length).toBeGreaterThan(10);
    expect(detail!.contract.riskScore).toBeGreaterThan(0);
    quiet.mockRestore();
  });
});
