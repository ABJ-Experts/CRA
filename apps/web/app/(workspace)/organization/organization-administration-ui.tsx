import { Button } from "@repo/ui/button";

import { ApiClientError } from "../../_lib/http/api-client";

export function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.kind === "api") {
    if (error.status === 403) {
      return "The server denied this action. Your permissions may have changed.";
    }
    if (error.status === 404) {
      return "This organization resource is no longer available.";
    }
    return error.message;
  }
  return fallback;
}

export function isConflict(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.kind === "api" &&
    (error.status === 409 || error.code === "conflict")
  );
}

export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-caption-1-regular text-danger">
      {children}
    </p>
  );
}

export function ReadonlyNotice({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-subtle p-4">
      <p className="text-subhead-regular text-fg-muted">{children}</p>
    </div>
  );
}

export function ConflictNotice({
  label,
  onRefresh,
}: {
  label: string;
  onRefresh: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-caption-1-regular text-danger">
        {label} changed on the server. Your draft is still here; refresh before
        saving again.
      </p>
      <Button type="button" variant="outline" tone="grey" onClick={onRefresh}>
        Refresh {label.toLowerCase()}
      </Button>
    </div>
  );
}

/** Uses only the persisted organization timezone, never the browser locale. */
export function formatOrganizationInstant(
  instant: string,
  organizationTimezone: string | null,
): string {
  const timeZone = organizationTimezone ?? "UTC";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(instant));

  return organizationTimezone === null
    ? `${formatted} UTC`
    : `${formatted} (${organizationTimezone})`;
}

export function administrationLoadError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have access to organization administration.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "The selected organization is no longer available.";
  }
  return "Organization administration could not be loaded.";
}
