import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

import { Disclaimer } from "@/components/disclaimer";
import { Skeleton } from "@/components/ui/skeleton";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold tracking-tight">
              LegalGPT
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/dashboard"
                className="text-muted-foreground hover:text-foreground"
              >
                Contracts
              </Link>
              <Link
                href="/generate"
                className="text-muted-foreground hover:text-foreground"
              >
                Draft
              </Link>
              <Link
                href="/playbooks"
                className="text-muted-foreground hover:text-foreground"
              >
                Playbook
              </Link>
              <Link
                href="/compliance"
                className="text-muted-foreground hover:text-foreground"
              >
                Policies
              </Link>
              <Link
                href="/obligations"
                className="text-muted-foreground hover:text-foreground"
              >
                Obligations
              </Link>
            </nav>
            <Suspense fallback={<Skeleton className="h-7 w-40" />}>
              <OrganizationSwitcher
                hidePersonal
                afterCreateOrganizationUrl="/dashboard"
                afterSelectOrganizationUrl="/dashboard"
              />
            </Suspense>
          </div>
          <Suspense fallback={<Skeleton className="size-7 rounded-full" />}>
            <UserButton />
          </Suspense>
        </div>
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
