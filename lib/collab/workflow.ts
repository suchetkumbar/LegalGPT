import { and, asc, desc, eq, inArray } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { Contract, User } from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

const { contracts, comments, users, auditLog, findings } = schema;

/**
 * The review workflow: draft → in review → approved → signed. A contract can
 * also be sent back a step. Approval is a four-eyes check: whoever uploaded
 * the contract cannot approve it, so every approval involves two people.
 */
export const WORKFLOW_STATES = ["draft", "in_review", "approved", "signed"] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  signed: "Signed",
};

const NEXT: Record<WorkflowState, WorkflowState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["signed", "in_review"],
  signed: [],
};

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canTransition(
  contract: Pick<Contract, "workflowStatus" | "createdBy" | "assigneeId">,
  to: WorkflowState,
  actor: Pick<User, "id" | "role">,
): TransitionCheck {
  const from = contract.workflowStatus as WorkflowState;
  if (actor.role === "viewer")
    return { ok: false, reason: "Viewers cannot change a contract's status." };
  if (!NEXT[from]?.includes(to)) {
    return {
      ok: false,
      reason: `A contract cannot go from ${WORKFLOW_LABELS[from] ?? from} to ${WORKFLOW_LABELS[to]}.`,
    };
  }
  if (to === "approved") {
    if (contract.createdBy === actor.id) {
      return {
        ok: false,
        reason: "Someone other than the person who uploaded it must approve it.",
      };
    }
    if (
      contract.assigneeId &&
      contract.assigneeId !== actor.id &&
      actor.role !== "admin"
    ) {
      return {
        ok: false,
        reason: "Only the assigned reviewer or an admin can approve it.",
      };
    }
  }
  if (to === "signed" && actor.role !== "admin") {
    return { ok: false, reason: "Only an admin can mark a contract as signed." };
  }
  return { ok: true };
}

export async function setWorkflow(
  tx: OrgTx,
  input: {
    contractId: string;
    actor: User;
    status?: WorkflowState;
    assigneeId?: string | null;
  },
): Promise<Contract | { error: string; status: number }> {
  const [contract] = await tx
    .select()
    .from(contracts)
    .where(eq(contracts.id, input.contractId));
  if (!contract) return { error: "Not found", status: 404 };
  const changes: Partial<Contract> = {};

  if (input.assigneeId !== undefined) {
    if (input.actor.role === "viewer")
      return { error: "Viewers cannot assign contracts.", status: 403 };
    if (input.assigneeId) {
      // The assignee must be a reviewer or admin in this organisation (row-level security scopes the lookup).
      const [assignee] = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.assigneeId));
      if (!assignee || assignee.role === "viewer") {
        return {
          error: "Assign the contract to a reviewer or an admin in your organisation.",
          status: 400,
        };
      }
    }
    changes.assigneeId = input.assigneeId;
  }

  if (input.status && input.status !== contract.workflowStatus) {
    const check = canTransition(
      { ...contract, assigneeId: changes.assigneeId ?? contract.assigneeId },
      input.status,
      input.actor,
    );
    if (!check.ok) return { error: check.reason, status: 403 };
    changes.workflowStatus = input.status;
  }

  if (Object.keys(changes).length === 0) return contract;
  const [updated] = await tx
    .update(contracts)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(contracts.id, contract.id))
    .returning();
  await tx.insert(auditLog).values({
    orgId: contract.orgId,
    actorId: input.actor.id,
    action: changes.workflowStatus ? "contract.status_changed" : "contract.assigned",
    target: `contract:${contract.id}`,
    diff: {
      ...(changes.workflowStatus
        ? { status: [contract.workflowStatus, changes.workflowStatus] }
        : {}),
      ...(changes.assigneeId !== undefined
        ? { assigneeId: [contract.assigneeId, changes.assigneeId] }
        : {}),
    },
  });
  return updated;
}

export async function addComment(
  tx: OrgTx,
  input: { findingId: string; authorId: string; body: string },
) {
  const [finding] = await tx
    .select()
    .from(findings)
    .where(eq(findings.id, input.findingId));
  if (!finding) return null;
  const [comment] = await tx
    .insert(comments)
    .values({
      orgId: finding.orgId,
      contractId: finding.contractId,
      findingId: finding.id,
      authorId: input.authorId,
      body: input.body,
    })
    .returning();
  await tx.insert(auditLog).values({
    orgId: finding.orgId,
    actorId: input.authorId,
    action: "finding.commented",
    target: `finding:${finding.id}`,
    diff: { contractId: finding.contractId },
  });
  return comment;
}

export type CommentView = {
  id: string;
  findingId: string | null;
  author: string;
  body: string;
  createdAt: Date;
};

export async function listComments(
  tx: OrgTx,
  contractId: string,
): Promise<CommentView[]> {
  const rows = await tx
    .select({
      id: comments.id,
      findingId: comments.findingId,
      author: users.email,
      body: comments.body,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.contractId, contractId))
    .orderBy(asc(comments.createdAt));
  return rows.map((row) => ({ ...row, author: row.author ?? "Former member" }));
}

export function listMembers(tx: OrgTx) {
  return tx
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(inArray(users.role, ["admin", "reviewer"]))
    .orderBy(asc(users.email));
}

export async function listAudit(
  tx: OrgTx,
  options: { target?: string; limit?: number } = {},
) {
  return tx
    .select({
      id: auditLog.id,
      action: auditLog.action,
      target: auditLog.target,
      diff: auditLog.diff,
      at: auditLog.at,
      actor: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(options.target ? and(eq(auditLog.target, options.target)) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(options.limit ?? 200);
}
