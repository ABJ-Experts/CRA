"use client";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { ApiClientError } from "../../_lib/http/api-client";
export function operationError(error: unknown, fallback: string) {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform this action.";
  if (error instanceof ApiClientError && error.status === 409)
    return "Current data changed. Your draft is preserved. Reload and explicitly reapply it before previewing again.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "The service is unreachable. Check your connection and retry.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  return fallback;
}
export function OperationMessage({
  children,
  alert = false,
}: {
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <p
      role={alert ? "alert" : "status"}
      className={cn(
        "text-subhead-regular",
        alert ? "text-danger" : "text-fg-muted",
      )}
    >
      {children}
    </p>
  );
}
export function operationDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}
export function OperationPagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (value: number) => void;
}) {
  if (pageCount < 2) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption-1-regular text-fg-muted">
        Page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          tone="grey"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous page
        </Button>
        <Button
          variant="outline"
          tone="grey"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next page
        </Button>
      </div>
    </div>
  );
}
