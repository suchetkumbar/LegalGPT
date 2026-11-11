import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PrivacySettings } from "@/components/settings/privacy-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const { org, user } = await getAuthContext();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          How long {org.name} keeps its contract data. See the{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            privacy notice
          </Link>{" "}
          for what is sent to which service.
        </p>
      </div>
      {user.role === "admin" ? (
        <PrivacySettings retentionDays={org.retentionDays} orgName={org.name} />
      ) : (
        <p className="text-sm">Only an admin can change these settings.</p>
      )}
    </div>
  );
}
