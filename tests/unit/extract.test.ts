import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  extractEntities,
  pickCounterparty,
  verifyExtraction,
  type Extraction,
} from "@/lib/pipeline/extract";
import { normaliseText } from "@/lib/pipeline/parse";

import { EMPTY_EXTRACTION, fakeAi } from "../helpers/fake-ai";

const source = normaliseText(
  readFileSync("tests/fixtures/contracts/services-agreement.txt", "utf8"),
);

const GOOD: Extraction = {
  contractType: "master_services_agreement",
  parties: [
    {
      name: "Narmada Retail Private Limited",
      role: "Client",
      quote:
        "Narmada Retail Private Limited, a company incorporated under the Companies Act, 2013",
    },
    {
      name: "Tungabhadra Software Solutions Private Limited",
      role: "Service Provider",
      quote: "Tungabhadra Software Solutions Private Limited, a company incorporated",
    },
  ],
  effectiveDate: { iso: "2026-01-15", quote: "entered into on 15 January 2026" },
  term: {
    description: "3 years, renewing automatically for 1 year at a time",
    quote: "continues for an initial term of 3 years",
  },
  contractValue: {
    amount: 4800000,
    currency: "inr",
    description: "Total fees under the first statement of work, exclusive of taxes",
    quote: "INR 48,00,000 (Rupees Forty-Eight Lakh only)",
  },
  governingLaw: {
    value: "Laws of India",
    quote: "This Agreement shall be governed by the laws of India",
  },
  jurisdiction: {
    value: "Courts at Hyderabad",
    quote: "The courts at Hyderabad shall have exclusive jurisdiction",
  },
};

describe("verifyExtraction", () => {
  it("keeps every entity whose quote is in the contract", () => {
    const entities = verifyExtraction(source, GOOD);

    expect(entities.map((e) => [e.kind, e.label, e.value])).toEqual([
      ["party", "Client", "Narmada Retail Private Limited"],
      ["party", "Service Provider", "Tungabhadra Software Solutions Private Limited"],
      ["date", "effective_date", "2026-01-15"],
      ["term", "term", "3 years, renewing automatically for 1 year at a time"],
      [
        "amount",
        "contract_value",
        "Total fees under the first statement of work, exclusive of taxes",
      ],
      ["law", "governing_law", "Laws of India"],
      ["jurisdiction", "jurisdiction", "Courts at Hyderabad"],
    ]);
    for (const entity of entities) expect(entity.offset).toBeGreaterThanOrEqual(0);
  });

  it("normalises the rupee amount and the currency code", () => {
    const amount = verifyExtraction(source, GOOD).find((e) => e.kind === "amount");
    expect(amount?.normalized).toEqual({ amount: 4800000, currency: "INR" });
    expect(source.slice(amount!.offset)).toMatch(/^INR 48,00,000/);
  });

  it("drops anything the contract does not actually say", () => {
    const invented: Extraction = {
      ...GOOD,
      parties: [
        ...GOOD.parties,
        // Not a party to this contract.
        {
          name: "Reliance Industries Limited",
          role: "Guarantor",
          quote: "Narmada Retail Private Limited, a company incorporated",
        },
      ],
      // A plausible value with a made-up quote.
      contractValue: {
        amount: 9900000,
        currency: "INR",
        description: "Total fees",
        quote: "The total fees shall be INR 99,00,000",
      },
      // The model guessed arbitration; the contract says courts.
      jurisdiction: {
        value: "Arbitration seated in Mumbai",
        quote: "arbitration seated in Mumbai under the Arbitration and Conciliation Act",
      },
    };

    const entities = verifyExtraction(source, invented);

    expect(entities.filter((e) => e.kind === "party").map((e) => e.value)).toEqual([
      "Narmada Retail Private Limited",
      "Tungabhadra Software Solutions Private Limited",
    ]);
    expect(entities.some((e) => e.kind === "amount")).toBe(false);
    expect(entities.some((e) => e.kind === "jurisdiction")).toBe(false);
  });

  it("drops malformed dates and non-positive amounts", () => {
    const entities = verifyExtraction(source, {
      ...EMPTY_EXTRACTION,
      effectiveDate: { iso: "15 January 2026", quote: "entered into on 15 January 2026" },
      contractValue: {
        amount: 0,
        currency: "INR",
        description: "fees",
        quote: "INR 48,00,000 (Rupees Forty-Eight Lakh only)",
      },
    });
    expect(entities).toEqual([]);
  });
});

describe("pickCounterparty", () => {
  const parties = [
    "Narmada Retail Private Limited",
    "Tungabhadra Software Solutions Pvt. Ltd.",
  ];

  it("names the other side when one party is the organisation itself", () => {
    expect(pickCounterparty("Narmada Retail", parties)).toBe(
      "Tungabhadra Software Solutions Pvt. Ltd.",
    );
    expect(
      pickCounterparty("Tungabhadra Software Solutions Private Limited", parties),
    ).toBe("Narmada Retail Private Limited");
  });

  it("leaves it blank when it cannot tell", () => {
    expect(pickCounterparty("Some Law Firm LLP", parties)).toBeNull();
    expect(
      pickCounterparty("Narmada Retail", ["Narmada Retail Private Limited"]),
    ).toBeNull();
    expect(pickCounterparty("Pvt Ltd", parties)).toBeNull();
  });
});

describe("extractEntities", () => {
  it("makes one fast-tier call with the contract wrapped as data", async () => {
    const { ai, requests } = fakeAi({ extraction: GOOD });

    const result = await extractEntities(ai, source);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ tier: "fast", functionId: "pipeline.extract" });
    expect(requests[0].prompt).toMatch(/^<document>\n/);
    expect(requests[0].system).toMatch(/lakh and crore/);
    expect(result.contractType).toBe("master_services_agreement");
    expect(result.entities).toHaveLength(7);
  });

  it("keeps the start and the end of a very long contract", async () => {
    const { ai, requests } = fakeAi();
    const long = `PARTIES AT THE START\n${"filler text. ".repeat(20_000)}\nGOVERNING LAW AT THE END`;

    await extractEntities(ai, long);

    expect(requests[0].prompt.length).toBeLessThan(long.length);
    expect(requests[0].prompt).toContain("PARTIES AT THE START");
    expect(requests[0].prompt).toContain("GOVERNING LAW AT THE END");
  });
});
