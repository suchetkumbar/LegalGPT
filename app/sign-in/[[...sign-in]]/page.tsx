import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-sm" />}>
        <SignIn />
      </Suspense>
    </main>
  );
}
