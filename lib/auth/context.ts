import "server-only";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cache } from "react";

import { adminDb } from "@/lib/db";
import type { Org, User } from "@/lib/db/schema";

import { upsertMembership, upsertOrg } from "./sync";

export type AuthContext = { org: Org; user: User };

type Resolved =
  { state: "signed-out" } | { state: "no-org" } | { state: "ok"; context: AuthContext };

const resolve = cache(async (): Promise<Resolved> => {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return { state: "signed-out" };
  if (!orgId) return { state: "no-org" };

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

  return { state: "ok", context: { org, user } };
});

/**
 * For pages. The signed-in user and their active organisation, as rows in our
 * database. Redirects to sign-in or onboarding when either is missing. Pass
 * `org.id` to `withOrg()` for every tenant-scoped query.
 *
 * Cached per request, so layouts and pages can both call it freely.
 */
export async function getAuthContext(): Promise<AuthContext> {
  const resolved = await resolve();
  if (resolved.state === "signed-out") redirect("/sign-in");
  if (resolved.state === "no-org") redirect("/onboarding");
  return resolved.context;
}

/** For route handlers: returns null instead of redirecting, so the caller can send a 401. */
export async function getApiAuthContext(): Promise<AuthContext | null> {
  const resolved = await resolve();
  return resolved.state === "ok" ? resolved.context : null;
}

/** Viewers can read everything in their org but cannot add or change contracts. */
export function canEditContracts(user: User): boolean {
  return user.role === "admin" || user.role === "reviewer";
}
