import { cva, type VariantProps } from "class-variance-authority";

/**
 * The four table skins from the Pencil frames.
 *
 * They differ ONLY in row chrome. Columns and data are supplied per screen,
 * because the frames pair each skin with a different dataset (products,
 * orders, customers, coins) rather than showing one dataset four ways.
 *
 *   basic     EaMnQ   48px rows, hairline under each row
 *   striped   CTm6w   48px rows, alternating `surface` fill
 *   bordered  O5lpFJ  48px rows, full 1px `border` grid
 *   splitted  A6MS4   64px rows, each row its own r12 bordered card
 */

export const tableRowVariants = cva("group/row transition-colors", {
  variants: {
    variant: {
      basic: "border-b border-border last:border-b-0 hover:bg-surface",
      striped: "even:bg-surface hover:bg-surface-muted",
      bordered: "border-b border-border last:border-b-0 hover:bg-surface",
      /* `border-separate` on the table plus a full border here is what turns
       * each row into its own card. The radius is applied to the end cells
       * because a <tr> cannot be clipped in most engines. */
      splitted: "hover:bg-surface",
    },
    selected: { true: "", false: "" },
  },
  compoundVariants: [
    { variant: "basic", selected: true, class: "bg-accent-subtle hover:bg-accent-subtle" },
    { variant: "striped", selected: true, class: "bg-accent-subtle even:bg-accent-subtle hover:bg-accent-subtle" },
    { variant: "bordered", selected: true, class: "bg-accent-subtle hover:bg-accent-subtle" },
    { variant: "splitted", selected: true, class: "bg-accent-subtle hover:bg-accent-subtle" },
  ],
  defaultVariants: { variant: "basic", selected: false },
});

export const tableCellVariants = cva("px-3 text-left align-middle", {
  variants: {
    variant: {
      basic: "h-12",
      striped: "h-12",
      bordered: "h-12 border-r border-border last:border-r-0",
      /* First and last cell carry the card's rounded corners and its left and
       * right edges; the top and bottom edges come from the row. */
      splitted:
        "h-16 border-y border-border first:rounded-l-xl first:border-l last:rounded-r-xl last:border-r",
    },
  },
  defaultVariants: { variant: "basic" },
});

export const tableHeadVariants = cva(
  "px-3 text-left align-middle text-caption-1-semibold text-fg-muted",
  {
    variants: {
      variant: {
        /* The frames draw a hairline ABOVE the header cells, not below. */
        basic: "h-12 border-t border-border",
        striped: "h-12 border-t border-border",
        bordered: "h-12 border-t border-r border-border last:border-r-0",
        splitted: "h-12",
      },
      sortable: { true: "cursor-pointer select-none", false: "" },
    },
    defaultVariants: { variant: "basic", sortable: false },
  }
);

export type TableVariantProps = VariantProps<typeof tableRowVariants>;
export type DataTableVariant = NonNullable<TableVariantProps["variant"]>;
