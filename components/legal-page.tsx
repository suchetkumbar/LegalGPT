import { Logo } from "@/components/brand/logo-mark";
import Link from "next/link";
import type { ReactNode } from "react";

import { Disclaimer } from "@/components/disclaimer";

/** The frame for the public legal and help pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="LegalGPT home">
          <Logo className="text-lg" />
        </Link>
        <nav className="text-muted-foreground flex gap-4 text-sm">
          <Link href="/docs">Help</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/dpa">Data processing</Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_table]:mt-3 [&_td]:border-t [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:pr-4 [&_th]:text-left [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">Last updated {updated}.</p>
        {children}
      </main>
      <footer className="mx-auto w-full max-w-3xl px-6 py-6">
        <Disclaimer />
      </footer>
    </div>
  );
}
