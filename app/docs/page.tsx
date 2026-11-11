import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Help" };

export default function DocsPage() {
  return (
    <LegalPage title="How LegalGPT works" updated="12 November 2026">
      <p>
        LegalGPT reads a contract, finds its clauses, and flags risks, deviations from
        your standard positions and compliance gaps. Every finding quotes the words it is
        based on. It is a review assistant, not a lawyer: check what matters with a
        qualified one.
      </p>

      <h2>Reviewing a contract</h2>
      <ul>
        <li>
          Upload a PDF, Word or text file of up to 20 MB from the dashboard. Scanned PDFs
          are read by OCR.
        </li>
        <li>
          Analysis takes under a minute. It uses 4 AI calls; if the free AI quota is used
          up, you still get the rule-based review and can run the analysis again later.
        </li>
        <li>
          The risk score runs from 0 to 100: low under 30, medium to 59, high to 79,
          critical from 80. Any single critical finding puts the score at 70 or more.
        </li>
        <li>Accept or dismiss each finding. Dismissed findings leave the score.</li>
        <li>Choose &ldquo;Which party are we?&rdquo; so the review takes your side.</li>
      </ul>

      <h2>Your playbook and policies</h2>
      <ul>
        <li>
          The playbook holds your standard, fallback and walk-away position for 20 clause
          types, and how much each counts towards the score.
        </li>
        <li>
          Policies are your own rules, such as &ldquo;must not mention automatic
          renewal&rdquo;.
        </li>
        <li>
          Built-in checks cover the DPDP Act 2023, the Indian Contract Act 1872, the
          Arbitration Act 1996 and stamp duty, and GDPR or CCPA when a contract refers to
          them.
        </li>
      </ul>

      <h2>Drafting and negotiating</h2>
      <ul>
        <li>
          Draft builds a contract from a template and your playbook, and checks it before
          you see it.
        </li>
        <li>
          Negotiate turns findings into counter-proposals, from your playbook or by AI in
          three tones, and downloads a Word redline.
        </li>
        <li>
          Upload a revised draft from a contract&apos;s page to see every change, marked
          favourable or unfavourable.
        </li>
      </ul>

      <h2>Deadlines, questions and teams</h2>
      <ul>
        <li>
          Obligations lists expiry, renewal-notice and probation dates, exports them to
          your calendar, and emails admins 30, 7 and 1 days ahead.
        </li>
        <li>
          Ask a question on a contract page, or across all contracts on the Obligations
          page. Answers cite the clauses they rely on.
        </li>
        <li>
          Assign a reviewer and move a contract from review to approval to signature.
          Approval needs a second person.
        </li>
      </ul>
    </LegalPage>
  );
}
