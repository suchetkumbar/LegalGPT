import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-sm" />}>
        <SignUp />
      </Suspense>
    </main>
  );
}
