import { and, asc, eq } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { Playbook, PlaybookPositionRow } from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/score";

import { DEFAULT_POSITIONS } from "./defaults";

const { playbooks, playbookPositions, auditLog } = schema;

export type PlaybookWithPositions = {
  playbook: Playbook;
  positions: PlaybookPositionRow[];
};

function loadPositions(tx: OrgTx, playbookId: string) {
  return tx
    .select()
    .from(playbookPositions)
    .where(eq(playbookPositions.playbookId, playbookId))
    .orderBy(asc(playbookPositions.clauseType));
}

/** The organisation's active playbook, or null if it has none yet. */
export async function getPlaybook(tx: OrgTx): Promise<PlaybookWithPositions | null> {
  const [playbook] = await tx
    .select()
    .from(playbooks)
    .where(eq(playbooks.isDefault, true));
  if (!playbook) return null;
  return { playbook, positions: await loadPositions(tx, playbook.id) };
}

/** The active playbook, created from the defaults the first time it is needed. */
export async function ensurePlaybook(
  tx: OrgTx,
  orgId: string,
): Promise<PlaybookWithPositions> {
  const existing = await getPlaybook(tx);
  if (existing) return existing;

  const [playbook] = await tx
    .insert(playbooks)
    .values({ orgId, name: "Standard playbook" })
    .returning();
  await tx.insert(playbookPositions).values(
    DEFAULT_POSITIONS.map((position) => ({
      orgId,
      playbookId: playbook.id,
      clauseType: position.clauseType,
      standardText: position.standardText,
      fallbackText: position.fallbackText,
      walkaway: position.walkaway,
      riskWeight: position.riskWeight,
    })),
  );
  return { playbook, positions: await loadPositions(tx, playbook.id) };
}

/** Score weights from the playbook, or the built-in defaults if there is none. */
export async function getWeights(tx: OrgTx): Promise<Partial<Record<string, number>>> {
  const current = await getPlaybook(tx);
  if (!current || current.positions.length === 0) return DEFAULT_WEIGHTS;
  return Object.fromEntries(
    current.positions.map((position) => [position.clauseType, position.riskWeight]),
  );
}

export type PositionUpdate = {
  standardText: string;
  fallbackText: string | null;
  walkaway: string | null;
  riskWeight: number;
};

/** Edits one position and bumps the playbook version, so reports can say which they used. */
export async function updatePosition(
  tx: OrgTx,
  input: { positionId: string; actorId: string; update: PositionUpdate },
): Promise<PlaybookPositionRow | null> {
  const [before] = await tx
    .select()
    .from(playbookPositions)
    .where(eq(playbookPositions.id, input.positionId));
  if (!before) return null;

  const [after] = await tx
    .update(playbookPositions)
    .set(input.update)
    .where(eq(playbookPositions.id, input.positionId))
    .returning();

  const [playbook] = await tx
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, after.playbookId)));
  await tx
    .update(playbooks)
    .set({ version: playbook.version + 1, updatedAt: new Date() })
    .where(eq(playbooks.id, playbook.id));

  const changed = (Object.keys(input.update) as (keyof PositionUpdate)[]).filter(
    (key) => before[key] !== after[key],
  );
  await tx.insert(auditLog).values({
    orgId: after.orgId,
    actorId: input.actorId,
    action: "playbook.position_updated",
    target: `playbook_position:${after.id}`,
    diff: { clauseType: after.clauseType, changed, version: playbook.version + 1 },
  });
  return after;
}
