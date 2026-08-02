"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "../checkbox";

/**
 * The leading checkbox column the frames show on Basic, Striped and Bordered.
 *
 * Built here rather than in each screen so the header's indeterminate state
 * and the accessible names are defined once.
 */
export function selectionColumn<T>(options?: {
  /** Column width in px. The frames use 40 on Basic and 44 elsewhere. */
  size?: number;
  /** Describes a row for the checkbox's accessible name, e.g. "order 1042". */
  rowLabel?: (row: T) => string;
}): ColumnDef<T, unknown> {
  const { size = 44, rowLabel } = options ?? {};

  return {
    id: "select",
    size,
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        /* `indeterminate` is a third state, not "checked but partly". Radix
         * models it as the literal string, which is what drives the dash
         * glyph and `aria-checked="mixed"`. */
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? "indeterminate"
              : false
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        aria-label="Select all rows on this page"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(value) => row.toggleSelected(value === true)}
        aria-label={rowLabel ? `Select ${rowLabel(row.original)}` : "Select row"}
      />
    ),
  };
}
