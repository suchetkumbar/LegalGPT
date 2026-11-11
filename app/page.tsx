import Link from "next/link";

import { Disclaimer } from "@/components/disclaimer";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Risk score with reasons",
    body: "A 0–100 score broken down by liability, IP, termination, payment, data and renewal.",
  },
  {
    title: "Clause-by-clause review",
    body: "Each clause compared against your own playbook, with the deviation and a suggested fix.",
  },
  {
    title: "Compliance checks",
    body: "DPDP Act 2023 and the Indian Contract Act 1872 first, then GDPR and CCPA.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">LegalGPT</span>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Know what a contract commits you to before you sign it.
        </h1>
        <p className="text-muted-foreground mt-5 max-w-xl text-lg">
          Upload a contract and get a risk score, a comparison against your standard
          positions and a compliance check. Every finding quotes the clause it came from.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/sign-up">Create your workspace</Link>
          </Button>
        </div>

        <ul className="mt-16 grid gap-8 sm:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title}>
              <h2 className="font-medium">{feature.title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{feature.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6">
        <Disclaimer />
        <nav className="text-muted-foreground flex gap-4 text-xs">
          <Link href="/docs">How it works</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/dpa">Data processing</Link>
        </nav>
      </footer>
    </div>
  );
}
