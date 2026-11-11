import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy notice" };

/**
 * A starting draft, written to match how the software actually handles data.
 * It must be reviewed by a lawyer and completed with the operator's details
 * before the service is offered to anyone.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" updated="12 November 2026">
      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        Draft. This notice describes how the software handles data. The operator of this
        service must add its legal name, address and grievance officer, and have it
        reviewed by a lawyer, before offering the service.
      </p>

      <h2>What we process</h2>
      <ul>
        <li>
          Account details from sign-in: name, email address and organisation membership.
        </li>
        <li>
          Contracts you upload, and what is derived from them: the extracted text,
          clauses, parties, dates, amounts, risk findings, comments and deadlines.
          Contracts often contain personal data of the people named in them.
        </li>
        <li>
          An audit log of actions taken in your organisation, and counts of AI usage.
        </li>
      </ul>

      <h2>Why</h2>
      <p>
        Only to provide the review service to your organisation. We do not sell data or
        use it for advertising. Under the Digital Personal Data Protection Act, 2023, your
        organisation is the data fiduciary for the personal data in its contracts, and the
        operator of this service processes it on your behalf.
      </p>

      <h2>Where it goes</h2>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>What it receives</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Google (Gemini API)</td>
            <td>Contract text and questions, for analysis</td>
            <td>
              <strong>
                On the free tier Google may use this content to improve its products.
              </strong>{" "}
              Do not upload confidential contracts until the service is moved to a paid
              tier, where it does not.
            </td>
          </tr>
          <tr>
            <td>Neon (database)</td>
            <td>All of the above, stored</td>
            <td>Region chosen when the database is created.</td>
          </tr>
          <tr>
            <td>Vercel (hosting and file storage)</td>
            <td>Uploaded files and requests</td>
            <td>Functions run in Mumbai (bom1).</td>
          </tr>
          <tr>
            <td>Clerk (sign-in)</td>
            <td>Account details</td>
            <td>Stored outside India.</td>
          </tr>
          <tr>
            <td>Inngest (background jobs)</td>
            <td>Identifiers only, not contract text</td>
            <td>Only if configured.</td>
          </tr>
          <tr>
            <td>Resend (email)</td>
            <td>Admin email addresses and deadline summaries</td>
            <td>Only if configured.</td>
          </tr>
          <tr>
            <td>Sentry, Langfuse (monitoring)</td>
            <td>
              Error reports and model timings, with contract text and personal data
              switched off
            </td>
            <td>Only if configured.</td>
          </tr>
        </tbody>
      </table>

      <h2>How long</h2>
      <p>
        An admin chooses how long contracts are kept: 30, 90 or 365 days, or until
        deleted. A daily job deletes contracts past that age, with their files. Any
        contract, or all of an organisation&apos;s contracts, can be deleted at any time
        from the app.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for access to, correction of or erasure of your personal data, and
        nominate someone to act for you, as the DPDP Act provides. Contact the
        operator&apos;s grievance officer. You may also complain to the Data Protection
        Board of India.
      </p>
    </LegalPage>
  );
}
