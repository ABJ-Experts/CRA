"use client";
import Link from "next/link";
import { cn } from "@repo/ui/cn";
import { useSession } from "../../../_providers/session-provider";
export function SiemAuditLink() {
  const { permissions } = useSession();
  return permissions.can_view_audit && permissions.can_view_connectors ? (
    <div className={cn("mx-auto max-w-7xl px-6 pb-4")}>
      <Link
        className={cn(
          "text-subhead-regular text-active-500 underline underline-offset-4",
        )}
        href="/connectors/siem"
      >
        Manage SIEM forwarding
      </Link>
    </div>
  ) : null;
}
