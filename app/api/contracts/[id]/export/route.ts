import { z } from "zod";

import { getApiAuthContext } from "@/lib/auth/context";
import { getFullContract, type FullContract } from "@/lib/contracts/full";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  DISCLAIMER,
  findingsToCsv,
  redlineDocx,
  safeFileName,
  type ExportFinding,
  type Replacement,
} from "@/lib/export/export";

type Params = { params: Promise<{ id: string }> };

async function load(
  id: string,
  actor: { orgId: string; userId: string },
  format: string,
) {
  if (!isUuid(id)) return null;
  return withOrg(actor.orgId, async (tx) => {
    const contract = await getFullContract(tx, id);
    if (contract) {
      // Exports leave the system, so every one is audited.
      await tx.insert(schema.auditLog).values({
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "contract.exported",
        target: `contract:${id}`,
        diff: { format },
      });
    }
    return contract;
  });
}

function toExportFindings(contract: FullContract): ExportFinding[] {
  const label = (clauseId: string | null) => {
    const clause = contract.clauses.find((c) => c.id === clauseId);
    return clause ? (clause.number ?? clause.heading) : null;
  };
  return contract.findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    kind: finding.kind,
    category: finding.category,
    severity: finding.severity,
    likelihood: finding.likelihood,
    status: finding.status,
    clause: label(finding.clauseId),
    quotedText: finding.quotedText,
    reasoning: finding.reasoning,
    suggestedFix: finding.suggestedFix,
    model: finding.model,
  }));
}

async function docxResponse(contract: FullContract, byFinding: Map<string, string>) {
  const clauses = contract.clauses.map((clause) => {
    const replacements: Replacement[] = contract.findings
      .filter((f) => f.clauseId === clause.id && f.quotedText && byFinding.has(f.id))
      .map((f) => ({ quote: f.quotedText!, text: byFinding.get(f.id)! }));
    return { text: contract.clauseTexts.get(clause.id) ?? "", replacements };
  });
  const file = await redlineDocx({
    title: contract.contract.title,
    clauses,
    note: `Proposed changes are struck through and underlined. ${DISCLAIMER}`,
  });
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeFileName(contract.contract.title, "docx")}"`,
    },
  });
}

/**
 * GET ?format=csv|json — findings.
 * GET ?format=docx — the contract with the suggested fix of every accepted finding as a redline.
 */
export async function GET(request: Request, { params }: Params) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (!["csv", "json", "docx"].includes(format)) {
    return Response.json({ error: "format must be csv, json or docx" }, { status: 400 });
  }

  const { id } = await params;
  const contract = await load(
    id,
    { orgId: context.org.id, userId: context.user.id },
    format,
  );
  if (!contract) return Response.json({ error: "Not found" }, { status: 404 });

  if (format === "docx") {
    const accepted = contract.findings.filter(
      (f) => f.status === "accepted" && f.suggestedFix,
    );
    return docxResponse(contract, new Map(accepted.map((f) => [f.id, f.suggestedFix!])));
  }

  const findings = toExportFindings(contract);
  if (format === "json") {
    return Response.json(
      {
        contract: {
          id: contract.contract.id,
          title: contract.contract.title,
          riskScore: contract.contract.riskScore,
        },
        disclaimer: DISCLAIMER,
        findings,
      },
      {
        headers: {
          "Content-Disposition": `attachment; filename="${safeFileName(contract.contract.title, "json")}"`,
        },
      },
    );
  }
  return new Response(findingsToCsv(findings), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFileName(contract.contract.title, "csv")}"`,
    },
  });
}

const redlineBody = z.object({
  replacements: z
    .array(
      z.object({
        findingId: z.string().refine(isUuid),
        text: z.string().trim().min(1).max(5000),
      }),
    )
    .max(50),
});

/** POST: the contract as a redline with the counter-proposals chosen in the negotiation view. */
export async function POST(request: Request, { params }: Params) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = redlineBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid replacements." }, { status: 400 });

  const { id } = await params;
  const contract = await load(
    id,
    { orgId: context.org.id, userId: context.user.id },
    "docx",
  );
  if (!contract) return Response.json({ error: "Not found" }, { status: 404 });

  return docxResponse(
    contract,
    new Map(parsed.data.replacements.map((r) => [r.findingId, r.text])),
  );
}
