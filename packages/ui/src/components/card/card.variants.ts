import { cva, type VariantProps } from "class-variance-authority";

/**
 * Card - Pencil frame `qK67c`.
 *
 * That frame holds twenty finished dashboard cards (Market Graph, Revenue,
 * Coin, Recent Activity, ...). Those are app compositions, not library
 * components - what every one of them shares is the chrome, and that is what
 * lives here.
 *
 * Reading the chrome across all twenty gives exactly three treatments:
 *
 * | variant  | radius | padding | gap | surface            | border   |
 * | -------- | ------ | ------- | --- | ------------------ | -------- |
 * | outlined | 12     | 24      | 24  | #ffffff / #1b1d1f  | 1px      |
 * | filled   | 12     | 16      | 16  | #f5f5f5 / #26282a  | none     |
 * | primary  | 12     | 24      | 12  | #595fe5, both      | none     |
 *
 * `outlined` is the default: fifteen of the twenty use it. `filled` is the
 * compact Coin card. `primary` is Summary's `Primary Mode=On` - `active-500`
 * in both themes with white text, exactly like the Button's fill/primary.
 *
 * The header (`_chart card_header`) is a 24-gap centred row: title on the
 * left, an action or note slot on the right.
 */

export const cardVariants = cva(
  ["flex flex-col rounded-xl", "min-w-0"].join(" "),
  {
    variants: {
      variant: {
        outlined: "bg-canvas border border-border",
        filled: "bg-surface",
        primary: "bg-active-500 text-white",
      },
      size: {
        md: "p-6 gap-6",
        sm: "p-4 gap-4",
      },
      /** Lift on hover. Only for cards that are themselves a link or button. */
      interactive: {
        true: [
          "cursor-pointer text-left",
          "transition-[box-shadow,border-color,background-color] duration-200",
          "motion-reduce:transition-none",
          "hover:shadow-lg hover:shadow-scrim-black-30",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        ].join(" "),
        false: "",
      },
    },
    compoundVariants: [
      // Summary's Primary Mode tightens the gap to 12 while keeping padding 24.
      { variant: "primary", size: "md", class: "gap-3" },
      { variant: "outlined", interactive: true, class: "hover:border-border-strong" },
    ],
    defaultVariants: { variant: "outlined", size: "md", interactive: false },
  }
);

/**
 * The `_chart card_header` row.
 *
 * The `sm` step is applied by CardHeader as a `[[data-card-size=sm]_&]`
 * ancestor rule rather than a CVA variant, so the sub-parts inherit the
 * card's size without a client-side context. Same for the title below.
 */
export const cardHeaderVariants = cva("flex min-w-0 items-center gap-6");

export const cardTitleVariants = cva("min-w-0 truncate text-headline-semibold");

export type CardVariantProps = VariantProps<typeof cardVariants>;
