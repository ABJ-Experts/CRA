"use client";

import { cn } from "@repo/ui/cn";
import { Tag } from "@repo/ui/tag";
import { MoreHorizontal } from "lucide-react";

/**
 * Cell renderers shared by the four Tables screens.
 *
 * The frames repeat three shapes: a two-line cell (strong value over a muted
 * caption), a status pill, and a trailing action button. Defining them once
 * keeps the four tables visually identical where the design intends them to
 * be, and keeps each screen's column definitions to just its data.
 */

/** The frames' recurring "value over caption" cell. */
export function Stacked({ value, caption }: { value: string; caption?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-subhead-medium text-fg">{value}</span>
      {caption ? (
        <span className="truncate text-caption-2-regular text-fg-muted">{caption}</span>
      ) : null}
    </div>
  );
}

export function Plain({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "truncate",
        muted ? "text-caption-1-regular text-fg-muted" : "text-subhead-regular text-fg",
      )}
    >
      {value}
    </span>
  );
}

const STATUS_TONE = {
  Active: "green",
  Inactive: "red",
  Opened: "indigo",
  Closed: "red",
  Delivered: "green",
} as const;

export type StatusValue = keyof typeof STATUS_TONE;

export function StatusTag({ value }: { value: StatusValue }) {
  return (
    <Tag variant="fill" tone={STATUS_TONE[value]} size="sm">
      {value}
    </Tag>
  );
}

/** Signed percentage, coloured by direction. Used by the Splitted coins table. */
export function Change({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "text-subhead-medium tabular-nums",
        value >= 0 ? "text-success-fg" : "text-danger-fg",
      )}
    >
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function RowActions({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg text-fg-subtle",
        "transition-colors hover:bg-surface-muted hover:text-fg",
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
      )}
    >
      <MoreHorizontal aria-hidden="true" className="size-4" />
    </button>
  );
}
