"use client";

import { useClerk, useOrganization, useOrganizationList } from "@clerk/nextjs";
import { Building2, Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** The organisation icon: a white building on a black tile (inverted in dark mode), the same for every organisation. */
export function OrgIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-foreground text-background inline-flex size-6 shrink-0 items-center justify-center rounded-md",
        className,
      )}
    >
      <Building2 className="size-3.5" strokeWidth={2.25} />
    </span>
  );
}

/**
 * The organisation switcher in the header, built on Clerk's hooks so its look
 * is entirely LegalGPT's. Managing members and creating organisations still
 * open Clerk's own dialogs.
 */
export function OrgSwitcher() {
  const router = useRouter();
  const clerk = useClerk();
  const { organization, isLoaded } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // Close on a click outside or on Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isLoaded) return <span className="bg-muted h-7 w-40 animate-pulse rounded-md" />;

  async function choose(id: string) {
    if (id === organization?.id || !setActive) return setOpen(false);
    setSwitching(id);
    await setActive({ organization: id });
    setSwitching(null);
    setOpen(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="hover:bg-muted flex items-center gap-2 rounded-md px-1.5 py-1 text-sm"
      >
        <OrgIcon />
        <span className="max-w-44 truncate font-medium">
          {organization?.name ?? "Choose a workspace"}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="bg-popover text-popover-foreground absolute left-0 z-50 mt-1 w-64 rounded-lg border p-1 shadow-lg"
        >
          <p className="text-muted-foreground px-2 py-1.5 text-xs">Workspaces</p>
          {userMemberships.data?.map((membership) => {
            const org = membership.organization;
            const active = org.id === organization?.id;
            return (
              <button
                key={org.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={switching !== null}
                onClick={() => choose(org.id)}
                className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-60"
              >
                <OrgIcon />
                <span className="flex-1 truncate">{org.name}</span>
                {active && <Check className="size-4" aria-hidden />}
              </button>
            );
          })}
          {userMemberships.hasNextPage && (
            <button
              type="button"
              onClick={() => userMemberships.fetchNext?.()}
              className="text-muted-foreground hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-xs"
            >
              Show more
            </button>
          )}
          <div className="my-1 border-t" />
          {organization && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                clerk.openOrganizationProfile();
              }}
              className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            >
              <Settings className="text-muted-foreground size-4" aria-hidden />
              Members and workspace settings
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              clerk.openCreateOrganization({ afterCreateOrganizationUrl: "/dashboard" });
            }}
            className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
          >
            <Plus className="text-muted-foreground size-4" aria-hidden />
            Create a workspace
          </button>
        </div>
      )}
    </div>
  );
}
