import { cva, type VariantProps } from "class-variance-authority";

/**
 * Select variants, transcribed from the Pencil design file.
 *
 * Source frames: X8DcF6 (Forms/Select Basic) and p2Wbv1 (Droplist).
 * Pencil encodes `Dark Mode={Off|On}, State={Default|Hover|Selecting|Error|Disabled}`
 * on the trigger, and `State={Default|Hover & Clicked}, Size={Default|Small}`
 * on the list rows.
 *
 * The trigger is pixel-identical to the Input field (400x40, r12,
 * padding [10,12,9,12], gap 12, same stroke colours per state), so it reuses
 * `inputFieldVariants` rather than duplicating that matrix.
 *
 *   design light / dark        token
 *   #ffffff / #26282a          elevated        dropdown panel
 *   #f5f5f5 / #2e3133          elevated-hover  hovered / highlighted row
 *   #1b1d1f / #ffffff          fg              row label
 *
 * NOTE on a design inconsistency: the Select's dark hover stroke is #ebecff,
 * whereas the Input's is #232445. Everything else about the two fields is
 * identical, so this reads as an oversight in the file. `accent-subtle` is
 * used for both, which keeps the two controls consistent and gives the dark
 * theme the darker, less glaring value.
 */
export const selectContentVariants = cva(
  [
    "z-50 overflow-hidden",
    "rounded-xl bg-elevated p-1",
    "shadow-lg shadow-scrim-black-30",
    // Radix sets data-state and data-side on the content.
    "data-[state=open]:animate-overlay-in",
    // NO exit animation, deliberately.
    //
    // Radix keeps the content mounted until its exit animation reports
    // `animationend`, and it holds the body scroll lock while mounted. That
    // event does not reliably arrive, and when it does not the panel stays in
    // the DOM and the page is left permanently unscrollable with no visible
    // cause. Measured: after Escape, `data-scroll-locked` still on <body> and
    // the listbox still present. Unmounting synchronously removes the whole
    // failure class - the same call made for the Modal and Alert overlays.
    "data-[state=closed]:animate-none",
    "motion-reduce:animate-none",
  ],
  {
    variants: {
      /** Match the trigger's width so the panel lines up under it. */
      matchTrigger: {
        true: "w-[var(--radix-select-trigger-width)]",
        false: "min-w-[8rem]",
      },
    },
    defaultVariants: { matchTrigger: true },
  }
);

export const selectItemVariants = cva(
  [
    "relative flex w-full cursor-pointer select-none items-center gap-2",
    "rounded-lg outline-none",
    "text-fg",
    "transition-colors duration-100 ease-out",
    "motion-reduce:transition-none",
    // Radix highlights via data-highlighted for both pointer and keyboard,
    // so hover and arrow-key focus share one treatment, as the design shows.
    "data-[highlighted]:bg-elevated-hover",
    "data-[state=checked]:text-active-500",
    "data-[disabled]:pointer-events-none data-[disabled]:text-fg-subtle",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      size: {
        // Pencil Size=Default: 44px row, padding [12,8,11,8], text 14/400.
        md: "gap-2 px-2 pt-3 pb-[11px] text-subhead-regular [&_svg]:size-4",
        // Pencil Size=Small: 34px row, padding 8, text 12/400.
        sm: "gap-2 p-2 text-caption-1-regular [&_svg]:size-4",
      },
    },
    defaultVariants: { size: "md" },
  }
);

export type SelectContentVariantProps = VariantProps<typeof selectContentVariants>;
export type SelectItemVariantProps = VariantProps<typeof selectItemVariants>;
