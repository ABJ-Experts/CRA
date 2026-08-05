import { cva, type VariantProps } from "class-variance-authority";

/**
 * Tabs — Pencil frame `o1gsz`.
 *
 * The frame is titled "Tags" but the component inside it is named `Tab`, and
 * its axes are `Dark Mode={Off|On} x Size={Default|Medium} x Type={Line|Fill|
 * Outline} x State={Default|Hover & Clicked|Selected}`. It is a tab bar, not a
 * tag, so it is built as one.
 *
 * Measured geometry:
 *
 * | Type    | h  | radius | padding       | gap | icon | label            |
 * | ------- | -- | ------ | ------------- | --- | ---- | ---------------- |
 * | Line    | 24 | -      | [0,0,8,0]     | 8   | 12   | caption-2-semibold |
 * | Line md | 34 | -      | [0,0,13,0]    | 8   | 16   | subhead-medium   |
 * | Fill    | 40 | -      | 12            | 8   | 12   | caption-2-semibold |
 * | Outline | 32 | 8      | [4,4,4,12]    | 12  | 16   | caption-1-medium |
 *
 * Colour resolution, all onto existing tokens with no drift:
 *   idle label   #9da2a7 / #55585a -> `fg-subtle`
 *   active label #1b1d1f / #ffffff -> `fg`
 *   hairline     #eeeeee / #2e3133 -> `border`
 *   hover wash   #f5f5f5 / #26282a -> `surface`
 *   active wash  #eeeeee / #2e3133 -> `surface-muted`
 *
 * Two design notes that are reproduced rather than "corrected":
 *  - `Fill` draws its 1px hairline on top/right/bottom only. That is
 *    deliberate: the tabs butt together into a segmented control, so the
 *    missing left edge is the previous tab's right edge.
 *  - `Line` hover and selected share every colour; only the underline differs
 *    (1px `border` -> 2px `fg`).
 */

/** Row that holds the triggers. Only `line` needs a shared baseline rule. */
export const tabsListVariants = cva("flex items-stretch", {
  variants: {
    variant: {
      // The underline is drawn per trigger, so the list itself stays bare and
      // a trigger's 2px selected border can overlap the 1px idle one.
      line: "gap-6",
      // Segmented: no gap, so adjacent 1px edges form one continuous hairline.
      fill: "gap-0",
      outline: "gap-2",
    },
  },
  defaultVariants: { variant: "line" },
});

export const tabsTriggerVariants = cva(
  [
    "group relative inline-flex shrink-0 items-center justify-center",
    "cursor-pointer whitespace-nowrap",
    // 250ms rather than the 150ms used for hovers: this reads as a state
    // change, and it is timed to match the sliding indicator so the label
    // and the bar arrive together.
    "transition-colors duration-250 ease-out motion-reduce:transition-none",
    "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:shrink-0",
    // Idle -> active label colour. Radix sets data-state on the trigger.
    "text-fg-subtle data-[state=active]:text-fg",
  ].join(" "),
  {
    variants: {
      variant: {
        line: [
          "gap-2 bg-transparent",
          "hover:text-fg",
          // The idle hairline is an ::after bar, not `border-b`.
          //
          // A Pencil stroke does not occupy layout: the frame measures 24px
          // (or 34px) in every state even as the underline steps 1px -> 2px.
          // A CSS border DOES occupy layout, so `border-b` would both inflate
          // the box by a pixel and shift the content when the state changed.
          // An absolutely positioned bar reproduces the design exactly and
          // makes the state change cost zero layout.
          //
          // The 2px SELECTED bar is deliberately not here: it is a single
          // shared element owned by TabsList so it can slide between tabs
          // rather than blinking off one and on the next.
          "after:absolute after:inset-x-0 after:bottom-0",
          "after:h-px after:bg-border",
        ].join(" "),
        fill: [
          "gap-2 border-y border-r border-border bg-transparent",
          "hover:bg-surface",
          // Padding is 1px short on each bordered edge so the total lands on
          // the design's 40px, same reasoning as `line` above.
          "py-[11px] pr-[11px] pl-3",
          // Selected drops the hairline but KEEPS its width, as transparent.
          // Removing it would shrink the box, and because the list is
          // `items-stretch` that resizes every sibling too.
          "data-[state=active]:border-transparent data-[state=active]:bg-surface-muted",
        ].join(" "),
        outline: [
          "gap-3 rounded-lg border border-border bg-transparent",
          // 1px short on every edge: 24 content + 6 padding + 2 border = 32,
          // and 11 + 1 = the design's 12px left inset.
          "py-[3px] pr-[3px] pl-[11px]",
          "hover:bg-surface",
          "data-[state=active]:border-transparent data-[state=active]:bg-surface-muted",
        ].join(" "),
      },
      size: {
        sm: "",
        md: "",
      },
    },
    compoundVariants: [
      // `line` is the only type the design gives a Medium size.
      //
      // The explicit height pins the content box to the design's inner frame
      // (24 - 8 = 16, and 34 - 13 = 21). Without it a trigger that has no
      // count pill would be a pixel shorter than its neighbours, because the
      // pill is the tallest thing in the row.
      {
        variant: "line",
        size: "sm",
        class: "h-6 pb-2 text-caption-2-semibold [&_svg]:size-3",
      },
      {
        variant: "line",
        size: "md",
        class: "h-[34px] pb-[13px] text-subhead-medium [&_svg]:size-4",
      },
      { variant: "fill", class: "text-caption-2-semibold [&_svg]:size-3" },
      { variant: "outline", class: "text-caption-1-medium [&_svg]:size-4" },
    ],
    defaultVariants: { variant: "line", size: "sm" },
  },
);

/**
 * The count pill inside a trigger. Its palette is driven by the parent
 * trigger's `data-state`, which is why every rule is a `group-data-*`.
 *
 * `line` and `fill` share one pill (28x16, r 8); `outline` has its own
 * (32x24, r 6 idle / r 9 selected).
 */
export const tabsCountVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "text-caption-2-semibold tabular-nums",
    "transition-colors duration-250 ease-out motion-reduce:transition-none",
  ].join(" "),
  {
    variants: {
      variant: {
        line: [
          "min-w-7 rounded-lg px-1 pt-px",
          "bg-border-strong text-canvas",
          // Hover and selected both promote the pill to full contrast.
          "group-hover:bg-fg group-hover:text-canvas",
          "group-data-[state=active]:bg-fg group-data-[state=active]:text-canvas",
        ].join(" "),
        fill: [
          "min-w-7 rounded-lg px-1 pt-px",
          "bg-border-strong text-canvas",
          // Fill's idle and hover pills are identical in the design; only the
          // selected state changes, to a canvas-coloured pill on the wash.
          // Its label drops to `fg-subtle` (#9da2a7 / #55585a), not `fg`.
          "group-data-[state=active]:bg-canvas group-data-[state=active]:text-fg-subtle",
        ].join(" "),
        outline: [
          "h-6 min-w-8 rounded-md px-1.5",
          "bg-surface text-fg-subtle",
          // Radius steps 6 -> 9 when selected. Reproduced from the frame.
          "group-data-[state=active]:rounded-[9px]",
          "group-data-[state=active]:bg-canvas group-data-[state=active]:text-fg-muted",
        ].join(" "),
      },
    },
    defaultVariants: { variant: "line" },
  },
);

export type TabsVariantProps = VariantProps<typeof tabsTriggerVariants>;
