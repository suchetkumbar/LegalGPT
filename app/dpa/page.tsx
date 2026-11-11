import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Data processing terms" };

/** A draft summary of processor terms, written to match the software. Needs a lawyer before use. */
export default function DpaPage() {
  return (
    <LegalPage title="Data processing terms" updated="12 November 2026">
      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        Draft summary. A signed data processing agreement, reviewed by a lawyer, is needed
        before any organisation relies on these terms.
      </p>

      <h2>Roles</h2>
      <p>
        The customer organisation is the data fiduciary (under the DPDP Act, 2023) or
        controller (under the GDPR) for personal data in the contracts it uploads. The
        operator of this service is its data processor, and processes that data only to
        provide the service and on the customer&apos;s instructions.
      </p>

      <h2>Commitments, and how the software meets them</h2>
      <ul>
        <li>
          <strong>Separation of customers.</strong> Every table is protected by row-level
          security on the organisation, and automated tests try to read and write across
          organisations.
        </li>
        <li>
          <strong>Security.</strong> Files are stored privately and served only through
          the application after an organisation check. Model traces do not record contract
          text.
        </li>
        <li>
          <strong>Breach notification.</strong> The operator will tell the customer of a
          personal data breach without undue delay, so the customer can notify the Data
          Protection Board and affected people.
        </li>
        <li>
          <strong>Sub-processors.</strong> Listed on the privacy notice. The free Gemini
          tier may use content to improve Google&apos;s products; the service must move to
          a paid tier before confidential contracts are processed.
        </li>
        <li>
          <strong>Deletion.</strong> Customers set a retention period and can delete any
          contract, or all their contracts, at any time. Files are deleted with them.
        </li>
        <li>
          <strong>Audit.</strong> Every upload, review decision, export, setting change
          and deletion is recorded in an append-only audit log the customer&apos;s admins
          can read.
        </li>
        <li>
          <strong>Transfers.</strong> Functions run in India (Mumbai). Some sub-processors
          store data outside India, as listed on the privacy notice.
        </li>
      </ul>
    </LegalPage>
  );
}
