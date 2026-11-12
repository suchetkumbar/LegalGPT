import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo-mark";
import { OrgSwitcher } from "@/components/brand/org-switcher";
import { Disclaimer } from "@/components/disclaimer";
import { Skeleton } from "@/components/ui/skeleton";

const NAV = [
  ["/dashboard", "Contracts"],
  ["/generate", "Draft"],
  ["/analytics", "Portfolio"],
  ["/obligations", "Obligations"],
  ["/bulk", "Bulk scan"],
  ["/playbooks", "Playbook"],
  ["/compliance", "Policies"],
  ["/usage", "Usage"],
  ["/audit", "Audit"],
  ["/settings", "Settings"],
] as const;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" aria-label="LegalGPT home">
              <Logo />
            </Link>
            <span className="text-border text-xl font-light" aria-hidden>
              /
            </span>
            <Suspense fallback={<Skeleton className="h-7 w-40" />}>
              <OrgSwitcher />
            </Suspense>
          </div>
          <Suspense fallback={<Skeleton className="size-7 rounded-full" />}>
            <UserButton />
          </Suspense>
        </div>
        <nav
          aria-label="Main"
          className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-6 pb-2.5 text-sm"
        >
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-4">
          <Disclaimer />
        </div>
      </footer>
    </div>
  );
}
