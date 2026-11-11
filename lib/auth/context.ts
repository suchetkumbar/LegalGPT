import "server-only";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cache } from "react";

import { adminDb } from "@/lib/db";
import type { Org, User } from "@/lib/db/schema";

import { upsertMembership, upsertOrg } from "./sync";

export type AuthContext = { org: Org; user: User };

/**
 * The signed-in user and their active organisation, as rows in our database.
 * Redirects to sign-in or onboarding when either is missing. Pass `org.id`
 * to `withOrg()` for every tenant-scoped query.
 *
 * Cached per request, so layouts and pages can both call it freely.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  const db = adminDb();

  // The webhook normally creates these rows; syncing here as well means the
  // first page load after sign-up never races it.
  const [clerkUser, clerkOrg] = await Promise.all([
    currentUser(),
    (await clerkClient()).organizations.getOrganization({ organizationId: orgId }),
  ]);
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress ??
    "";

  const org = await upsertOrg(db, { clerkOrgId: orgId, name: clerkOrg.name });
  const user = await upsertMembership(db, {
    orgId: org.id,
    clerkUserId: userId,
    email,
    clerkRole: orgRole,
  });

  return { org, user };
});
