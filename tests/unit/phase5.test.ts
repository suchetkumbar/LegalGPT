import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { answerQuestion } from "@/lib/ask/answer";
import { fuseRankings, type Source } from "@/lib/ask/retrieve";
import { daysUntil, dueThreshold, toIcs } from "@/lib/obligations/calendar";
import { extractObligations, spans } from "@/lib/obligations/extract";
import type { PipelineAi, StructuredRequest } from "@/lib/pipeline/ai";
import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";

function clausesOf(name: string) {
  const text = normaliseText(
    readFileSync(`tests/fixtures/contracts/${name}.txt`, "utf8"),
  );
  return segmentContract(text).map((s) => ({
    ordinal: s.ordinal,
    type: null,
    heading: s.heading,
    text: s.text,
  }));
}

const byKind = (items: ReturnType<typeof extractObligations>) =>
  Object.fromEntries(items.map((item) => [item.kind, item]));

describe("obligation extraction", () => {
  it("works out expiry and the last day to stop auto-renewal", () => {
    const found = byKind(
      extractObligations({
        clauses: clausesOf("services-agreement"),
        effectiveDate: "2026-01-15",
      }),
    );
    // 3 years from 15 Jan 2026 ends the day before the third anniversary.
    expect(found.expiry.dueDate).toBe("2029-01-14");
    // 120 days before that.
    expect(found.renewal_notice).toMatchObject({
      dueDate: "2028-09-16",
      noticeDays: 120,
    });
    expect(found.payment).toMatchObject({
      dueDate: null,
      recurrence: "monthly",
      noticeDays: 90,
    });
    expect(found.notice_period.noticeDays).toBe(30);
  });

  it("finds probation in an employment agreement, and the term in a 'Term and Termination' clause", () => {
    const employment = byKind(
      extractObligations({
        clauses: clausesOf("employment-agreement"),
        effectiveDate: "2026-04-01",
      }),
    );
    expect(employment.probation_end.dueDate).toBe("2026-09-30");
    expect(employment.notice_period.noticeDays).toBe(90);

    const nda = byKind(
      extractObligations({
        clauses: clausesOf("mutual-nda"),
        effectiveDate: "2026-06-03",
      }),
    );
    expect(nda.expiry.dueDate).toBe("2028-06-02");
  });

  it("lists obligations without dates when the effective date is unknown", () => {
    const found = byKind(
      extractObligations({
        clauses: clausesOf("services-agreement"),
        effectiveDate: null,
      }),
    );
    expect(found.expiry.dueDate).toBeNull();
    expect(found.renewal_notice.dueDate).toBeNull();
  });

  it("quotes the clause each obligation comes from", () => {
    const clauses = clausesOf("services-agreement");
    for (const item of extractObligations({ clauses, effectiveDate: "2026-01-15" })) {
      expect(clauses[item.clauseOrdinal!].text).toContain(item.quotedText!);
    }
  });

  it("adds calendar months, clamped to the end of the month", () => {
    expect(spans("for 6 months")[0]).toMatchObject({ amount: 6, unit: "month" });
    const [found] = extractObligations({
      clauses: [
        {
          ordinal: 0,
          type: "term_and_renewal",
          heading: "Term",
          text: "This Agreement continues for a period of 1 month.",
        },
      ],
      effectiveDate: "2026-01-31",
    });
    // One month from 31 January is 28 February; the term ends the day before.
    expect(found.dueDate).toBe("2026-02-27");
  });
});

describe("reminders", () => {
  it("sends at 30, 7 and 1 days, once each, and never a larger one after a smaller", () => {
    expect(dueThreshold("2026-12-31", "2026-11-12", [])).toBeNull(); // 49 days
    expect(dueThreshold("2026-12-31", "2026-12-01", [])).toBe(30);
    expect(dueThreshold("2026-12-31", "2026-12-01", [30])).toBeNull();
    expect(dueThreshold("2026-12-31", "2026-12-26", [30])).toBe(7); // 5 days
    // Created late, 5 days out: send the 7-day reminder, then never the 30-day one.
    expect(dueThreshold("2026-12-31", "2026-12-26", [])).toBe(7);
    expect(dueThreshold("2026-12-31", "2026-12-27", [7])).toBeNull();
    expect(dueThreshold("2026-12-31", "2026-12-30", [30, 7])).toBe(1);
    expect(dueThreshold("2026-12-31", "2027-01-01", [])).toBeNull(); // past
    expect(dueThreshold(null, "2026-12-01", [])).toBeNull();
    expect(daysUntil("2026-12-31", "2026-12-30")).toBe(1);
  });

  it("writes a valid iCalendar file with all-day events and escaped text", () => {
    const ics = toIcs(
      [
        {
          id: "a1",
          contractId: "c",
          contractTitle: "MSA; Narmada, Tungabhadra",
          description: "Contract expires",
          dueDate: "2029-01-14",
          quotedText: "continues for 3 years",
        },
        {
          id: "a2",
          contractId: "c",
          contractTitle: "x",
          description: "No date",
          dueDate: null,
          quotedText: null,
        },
      ],
      new Date("2026-11-12T10:00:00Z"),
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART;VALUE=DATE:20290114");
    expect(ics).toContain("DTEND;VALUE=DATE:20290115");
    expect(ics).toContain("SUMMARY:MSA\\; Narmada\\, Tungabhadra: Contract expires");
    expect(ics).toContain("DTSTAMP:20261112T100000Z");
    for (const line of ics.split("\r\n"))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("ask the contract", () => {
  it("fuses full-text and vector rankings, rewarding agreement", () => {
    const a = { clause_id: "a" };
    const b = { clause_id: "b" };
    const c = { clause_id: "c" };
    const fused = fuseRankings(
      [
        [a, b],
        [b, c],
      ],
      3,
    ).map((entry) => entry.row.clause_id);
    expect(fused[0]).toBe("b"); // in both lists
    expect(fused).toHaveLength(3);
  });

  const sources: Source[] = [
    {
      clauseId: "c1",
      contractId: "k1",
      contractTitle: "MSA",
      label: "7.1 Termination",
      text: "7.1 The Service Provider may terminate this Agreement for convenience by giving 30 days written notice.",
      score: 1,
    },
    {
      clauseId: "c2",
      contractId: "k1",
      contractTitle: "MSA",
      label: "2.2 Fees",
      text: "2.2 The Client shall pay each undisputed invoice within 90 days of receipt.",
      score: 0.5,
    },
  ];

  function aiAnswering(object: unknown) {
    const requests: StructuredRequest<unknown>[] = [];
    const ai: PipelineAi = {
      async generateStructured(request) {
        requests.push(request as StructuredRequest<unknown>);
        return {
          object: request.schema.parse(object),
          modelId: "fake",
          usedFallback: false,
          usage: { tokensIn: 1, tokensOut: 1 },
        };
      },
      async embed() {
        throw new Error("unused");
      },
    };
    return { ai, requests };
  }

  it("keeps only citations whose quote is in the cited source", async () => {
    const { ai, requests } = aiAnswering({
      answer: "The supplier can leave on 30 days' notice [S1].",
      citations: [
        { source: 1, quote: "giving 30 days written notice" },
        { source: 2, quote: "giving 30 days written notice" }, // wrong source
        { source: 1, quote: "on 7 days notice" }, // not in the text
        { source: 9, quote: "anything" }, // no such source
      ],
      notInSources: false,
    });

    const answer = await answerQuestion(ai, {
      question: "Notice period?",
      sources,
      portfolio: false,
      deep: false,
    });

    expect(answer.citations).toEqual([
      {
        source: 1,
        clauseId: "c1",
        contractId: "k1",
        label: "7.1 Termination",
        contractTitle: "MSA",
        quote: "giving 30 days written notice",
      },
    ]);
    expect(answer.unverified).toBe(false);
    expect(requests[0]).toMatchObject({ tier: "standard", functionId: "ask.answer" });
    expect(requests[0].prompt).toMatch(/<document>\n\[S1\] 7\.1 Termination/);
  });

  it("flags an answer none of whose quotes check out, and uses the reasoning tier for deep analysis", async () => {
    const { ai, requests } = aiAnswering({
      answer: "Six months [S1].",
      citations: [{ source: 1, quote: "six months notice is required" }],
      notInSources: false,
    });
    const answer = await answerQuestion(ai, {
      question: "Notice?",
      sources,
      portfolio: true,
      deep: true,
    });
    expect(answer).toMatchObject({ citations: [], unverified: true });
    expect(requests[0].tier).toBe("reasoning");
    // Portfolio questions name the contract with each source.
    expect(requests[0].prompt).toContain("[S1] MSA, 7.1 Termination");
  });

  it("passes on an honest 'not in the contract'", async () => {
    const { ai } = aiAnswering({
      answer: "The contract does not say.",
      citations: [{ source: 1, quote: "giving 30 days written notice" }],
      notInSources: true,
    });
    const answer = await answerQuestion(ai, {
      question: "Insurance?",
      sources,
      portfolio: false,
      deep: false,
    });
    expect(answer).toMatchObject({
      notInSources: true,
      citations: [],
      unverified: false,
    });
  });
});
