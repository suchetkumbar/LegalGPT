import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import { retrieve } from "@/lib/ask/retrieve";
import { createContract } from "@/lib/contracts/queries";
import * as schema from "@/lib/db/schema";
import { runAsOrg, type OrgTx } from "@/lib/db/tenant";
import { listObligations } from "@/lib/obligations/queries";
import { runAnalysis } from "@/lib/pipeline/analyze";

import { EMPTY_EXTRACTION, fakeAi } from "../helpers/fake-ai";

const { orgs, users, clauses } = schema;
const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });
const files = new Map<string, Uint8Array>();
let orgA: string;
let orgB: string;
let userA: string;
let userB: string;

const scopeFor =
  (orgId: string) =>
  <T>(fn: (tx: OrgTx) => Promise<T>) =>
    runAsOrg(db, orgId, fn);

async function analyse(
  orgId: string,
  userId: string,
  fixture: string,
  effectiveDate: string | null,
) {
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
      fileHash: "t",
    }),
  );
  const text = new TextDecoder().decode(files.get(storageKey));
  const extraction = effectiveDate
    ? {
        ...EMPTY_EXTRACTION,
        effectiveDate: {
          iso: effectiveDate,
          quote: text.match(/(?:made|entered into)[^.]{0,60}\d{4}/)![0],
        },
      }
    : EMPTY_EXTRACTION;
  await runAnalysis(
    {
      scope: scopeFor(orgId),
      readFile: async (key) => files.get(key)!,
      ai: fakeAi({ extraction }).ai,
    },
    { contractId: id, jobId: created.job.id },
  );
  return id;
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

describe("obligations in the pipeline", () => {
  it("stores dated obligations worked out from the extracted effective date", async () => {
    const contractId = await analyse(orgA, userA, "services-agreement", "2026-01-15");
    const items = await runAsOrg(db, orgA, (tx) => listObligations(tx, { contractId }));

    const byKind = Object.fromEntries(items.map((item) => [item.kind, item]));
    expect(byKind.expiry.dueDate).toBe("2029-01-14");
    expect(byKind.renewal_notice.dueDate).toBe("2028-09-16");
    expect(byKind.payment.dueDate).toBeNull();
    expect(items.every((item) => item.contractTitle === "services-agreement")).toBe(true);

    // Another organisation does not see them.
    expect(await runAsOrg(db, orgB, (tx) => listObligations(tx))).toEqual([]);
  });
});

describe("hybrid retrieval", () => {
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    mine = await analyse(orgA, userA, "services-agreement", null);
    theirs = await analyse(orgB, userB, "employment-agreement", null);
  });

  it("finds clauses by their words with full-text search", async () => {
    const sources = await runAsOrg(db, orgA, (tx) =>
      retrieve(tx, {
        question: "terminate for convenience",
        contractId: mine,
        embedding: null,
      }),
    );
    expect(sources[0].label).toMatch(/^7\.1/);
    expect(sources.every((s) => s.contractId === mine)).toBe(true);
  });

  it("also uses vector similarity when the question has an embedding", async () => {
    // Make one clause's stored vector identical to the "question", so it must rank first.
    // (The fake embeddings repeat every seven clauses, so give the target a unique one.)
    const [first] = await db
      .select()
      .from(clauses)
      .where(eq(clauses.contractId, mine))
      .limit(1);
    const unique = Array.from({ length: 768 }, (_, i) => (i === 5 ? 1 : 0));
    await db.update(clauses).set({ embedding: unique }).where(eq(clauses.id, first.id));
    const target = { id: first.id, embedding: unique };
    const sources = await runAsOrg(db, orgA, (tx) =>
      retrieve(tx, {
        question: "zzzz unmatched words",
        contractId: mine,
        embedding: target.embedding!,
      }),
    );
    expect(sources[0].clauseId).toBe(target.id);
  });

  it("searches the whole portfolio, but only within the caller's organisation", async () => {
    const sources = await runAsOrg(db, orgA, (tx) =>
      retrieve(tx, {
        question: "non-compete employment probation",
        contractId: null,
        embedding: null,
      }),
    );
    expect(sources.some((s) => s.contractId === theirs)).toBe(false);
    const theirsSearch = await runAsOrg(db, orgB, (tx) =>
      retrieve(tx, { question: "probation", contractId: null, embedding: null }),
    );
    expect(theirsSearch[0].contractId).toBe(theirs);
  });
});
