"use client";
import { useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useProductOwnerOptionsQuery } from "./product-owner-options.queries";
export function ProductOwnerSelector({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [page, setPage] = useState(1);
  const owners = useProductOwnerOptionsQuery(page, value);
  const rows = owners.data?.owners.rows ?? [];
  const selected = owners.data?.selectedOwner;
  const extra =
    selected && !rows.some((row) => row.id === selected.id) ? [selected] : [];
  const options = [...extra, ...rows];
  return (
    <div className={cn("flex min-w-0 flex-col gap-2")}>
      <label
        className={cn("flex flex-col gap-2 text-caption-1-regular text-fg")}
      >
        Responsible owner
        <select
          aria-label="Responsible owner"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-10 w-full min-w-0 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline focus-visible:outline-2",
          )}
        >
          <option value="">
            {owners.isPending ? "Loading owners…" : "Choose an active member"}
          </option>
          {value && !options.some((row) => row.id === value) && (
            <option value={value}>Selected owner unavailable</option>
          )}
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {row.displayName}
              {options.filter((other) => other.displayName === row.displayName)
                .length > 1
                ? ` (${row.id.slice(0, 8)})`
                : ""}
            </option>
          ))}
        </select>
      </label>
      {owners.isError && (
        <div
          role="alert"
          className={cn("text-caption-1-regular text-fg-muted")}
        >
          Owners could not be loaded. Your choice is preserved.{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => void owners.refetch()}
          >
            Retry owners
          </Button>
        </div>
      )}
      {owners.data && rows.length === 0 && (
        <p className={cn("text-caption-1-regular text-fg-muted")}>
          No active members on this page.
        </p>
      )}
      {(page > 1 || (owners.data?.owners.pageCount ?? 1) > 1) && (
        <div className={cn("flex gap-2")}>
          <Button
            type="button"
            variant="outline"
            disabled={page === 1 || owners.isFetching}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous owners
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              page >= (owners.data?.owners.pageCount ?? page) ||
              owners.isFetching
            }
            onClick={() => setPage((current) => current + 1)}
          >
            Next owners
          </Button>
        </div>
      )}
    </div>
  );
}
export function ProductOwnerLabel({
  ownerId,
  productId,
}: {
  readonly ownerId: string;
  readonly productId: string;
}) {
  const owners = useProductOwnerOptionsQuery(1, ownerId, productId);
  return (
    <span>
      {owners.isPending
        ? "Loading owner…"
        : (owners.data?.selectedOwner?.displayName ??
          (owners.isError
            ? "Owner temporarily unavailable"
            : "Owner unavailable or inactive"))}
    </span>
  );
}
