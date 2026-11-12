import type { Metadata } from "next";
import Link from "next/link";

import { Disclaimer } from "@/components/disclaimer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Shown for any address that does not exist, and for a contract this organisation cannot see. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
        Error 404
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        This page is not in the record
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md text-sm">
        The address may be mistyped, or the page has moved. If you followed a link to a
        contract, it may have been deleted, or it belongs to a workspace you are not
        signed in to.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">Go to your contracts</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-6 text-xs">
        Need help?{" "}
        <Link href="/docs" className="underline underline-offset-4">
          Read how LegalGPT works
        </Link>
        .
      </p>
      <Disclaimer className="mt-12" />
    </main>
  );
}
