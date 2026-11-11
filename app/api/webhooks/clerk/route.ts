import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";

import {
  removeMembership,
  removeOrg,
  upsertMembership,
  upsertOrg,
} from "@/lib/auth/sync";
import { adminDb } from "@/lib/db";

/**
 * Keeps `orgs` and `users` in step with Clerk. Subscribe this endpoint to the
 * organization.* and organizationMembership.* events in the Clerk dashboard.
 * The signature is checked against CLERK_WEBHOOK_SIGNING_SECRET.
 */
export async function POST(request: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(request);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = adminDb();

  switch (event.type) {
    case "organization.created":
    case "organization.updated":
      await upsertOrg(db, { clerkOrgId: event.data.id, name: event.data.name });
      break;

    case "organization.deleted":
      if (event.data.id) await removeOrg(db, event.data.id);
      break;

    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const { organization, public_user_data: member, role } = event.data;
      const org = await upsertOrg(db, {
        clerkOrgId: organization.id,
        name: organization.name,
      });
      await upsertMembership(db, {
        orgId: org.id,
        clerkUserId: member.user_id,
        email: member.identifier,
        clerkRole: role,
      });
      break;
    }

    case "organizationMembership.deleted":
      await removeMembership(db, {
        clerkOrgId: event.data.organization.id,
        clerkUserId: event.data.public_user_data.user_id,
      });
      break;
  }

  return Response.json({ received: true });
}
