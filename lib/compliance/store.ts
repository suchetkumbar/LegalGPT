import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import * as schema from "@/lib/db/schema";
import type { ComplianceResult } from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";
import { CLAUSE_TYPE_IDS } from "@/lib/pipeline/clause-types";
import { RISK_CATEGORIES } from "@/lib/rules/types";

import { phraseToPattern, type PackRule, type RulePack } from "./engine";
import { BUILT_IN_PACKS } from "./packs";

const { rulePacks, complianceResults, auditLog } = schema;

export const INTERNAL_CODE = "INTERNAL";

/**
 * A policy as an organisation writes it: plain phrases rather than patterns.
 * "Must mention" passes if any phrase appears; "must not mention" fails if
 * any does. Phrases are matched literally, whatever their spacing.
 */
export const policyInput = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(1000),
  mode: z.enum(["require", "forbid"]),
  phrases: z.array(z.string().trim().min(2).max(200)).min(1).max(20),
  clauseType: z.enum(CLAUSE_TYPE_IDS).nullable(),
  severity: z.enum(["fail", "warn"]),
  category: z.enum(RISK_CATEGORIES),
  fix: z.string().trim().max(1000).default(""),
});
export type PolicyInput = z.infer<typeof policyInput>;

/** Stored as a rule-pack rule, plus the original phrases so it can be shown and edited. */
type StoredPolicy = PackRule & { phrases: string[]; mode: "require" | "forbid" };

export function policyToRule(id: string, input: PolicyInput): StoredPolicy {
  const patterns = input.phrases.map(phraseToPattern);
  return {
    id,
    title: input.title,
    reference: "Internal policy",
    description: input.description,
    category: input.category,
    fix: input.fix || "Bring the contract into line with the internal policy.",
    phrases: input.phrases,
    mode: input.mode,
    check: {
      ...(input.clauseType ? { clauseTypes: [input.clauseType] } : {}),
      ...(input.mode === "require"
        ? { require: patterns, ifMissing: input.severity }
        : { forbid: patterns, ifForbidden: input.severity }),
    },
  };
}

async function internalRow(tx: OrgTx) {
  const [row] = await tx
    .select()
    .from(rulePacks)
    .where(eq(rulePacks.code, INTERNAL_CODE));
  return row ?? null;
}

export async function listPolicies(
  tx: OrgTx,
): Promise<{ version: number; rules: StoredPolicy[] }> {
  const row = await internalRow(tx);
  return {
    version: row?.version ?? 0,
    rules: (row?.rules as StoredPolicy[] | undefined) ?? [],
  };
}

/** The organisation's internal pack, if it has written any policies. */
async function internalPack(tx: OrgTx): Promise<RulePack | null> {
  const row = await internalRow(tx);
  const rules = (row?.rules as StoredPolicy[] | undefined) ?? [];
  if (!row || rules.length === 0) return null;
  return {
    code: INTERNAL_CODE,
    name: row.name,
    version: String(row.version),
    reviewedOn: row.updatedAt.toISOString().slice(0, 10),
    applicability: { always: true, description: "Your organisation's own policies." },
    rules,
  };
}

/** Every pack a contract is checked against: the built-in ones, then the organisation's own. */
export async function loadPacks(tx: OrgTx): Promise<RulePack[]> {
  const internal = await internalPack(tx);
  return internal ? [...BUILT_IN_PACKS, internal] : BUILT_IN_PACKS;
}

async function savePolicies(
  tx: OrgTx,
  orgId: string,
  actorId: string,
  rules: StoredPolicy[],
  action: string,
  target: string,
) {
  const row = await internalRow(tx);
  let version: number;
  if (row) {
    version = row.version + 1;
    await tx
      .update(rulePacks)
      .set({ rules, version, updatedAt: new Date() })
      .where(eq(rulePacks.id, row.id));
  } else {
    version = 1;
    await tx
      .insert(rulePacks)
      .values({ orgId, code: INTERNAL_CODE, name: "Internal policies", rules, version });
  }
  await tx.insert(auditLog).values({
    orgId,
    actorId,
    action,
    target,
    diff: { version },
  });
  return version;
}

export async function addPolicy(
  tx: OrgTx,
  input: { orgId: string; actorId: string; policy: PolicyInput },
): Promise<StoredPolicy> {
  const { rules } = await listPolicies(tx);
  const rule = policyToRule(`internal.${crypto.randomUUID().slice(0, 8)}`, input.policy);
  await savePolicies(
    tx,
    input.orgId,
    input.actorId,
    [...rules, rule],
    "policy.added",
    `policy:${rule.id}`,
  );
  return rule;
}

export async function removePolicy(
  tx: OrgTx,
  input: { orgId: string; actorId: string; ruleId: string },
): Promise<boolean> {
  const { rules } = await listPolicies(tx);
  const remaining = rules.filter((rule) => rule.id !== input.ruleId);
  if (remaining.length === rules.length) return false;
  await savePolicies(
    tx,
    input.orgId,
    input.actorId,
    remaining,
    "policy.removed",
    `policy:${input.ruleId}`,
  );
  return true;
}

export function getComplianceResults(
  tx: OrgTx,
  contractId: string,
): Promise<ComplianceResult[]> {
  return tx
    .select()
    .from(complianceResults)
    .where(eq(complianceResults.contractId, contractId))
    .orderBy(asc(complianceResults.createdAt), asc(complianceResults.id));
}
