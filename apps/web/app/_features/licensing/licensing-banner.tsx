"use client";

import Link from "next/link";
import { cn } from "@repo/ui/cn";
import { useLicensingQueries } from "./licensing.queries";
import { LICENCE_STATE_LABELS, licenceReason } from "./licensing-status";

/** A subordinate operational notice; the API remains the enforcement authority. */
export function LicensingBanner() {
  const { policy, enabled } = useLicensingQueries({ management: false });
  if (!enabled) return null;
  const data = policy.data;
  if (
    !policy.isError &&
    (!data || (data.state === "active" && !data.warnings.length))
  )
    return null;
  return (
    <aside
      aria-label="Licence notice"
      role="status"
      className={cn(
        "mx-6 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-caption-1-regular text-fg-muted",
      )}
    >
      <p className={cn("min-w-0 flex-1")}>
        {policy.isError
          ? "Licence status is unavailable. The server will verify each operation."
          : `${LICENCE_STATE_LABELS[data!.state]}. ${data!.warnings.map(licenceReason).join(". ")}${data!.customerWritesAllowed ? " Entitled writes remain available." : " Customer writes are restricted; authenticated manual evidence export remains available."}`}
      </p>
      <Link
        href="/organization?settings=licence"
        className={cn(
          "text-caption-1-semibold text-fg underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        )}
      >
        Review licence
      </Link>
    </aside>
  );
}
