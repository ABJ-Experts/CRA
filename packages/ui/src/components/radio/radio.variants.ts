import { cva, type VariantProps } from "class-variance-authority";

/**
 * Radio variants, transcribed from the Pencil design file.
 *
 * Source frame: z3sMFL (Radio Button). Pencil encodes
 * `Dark Mode={Off|On}, State={Default|Hover|Active|Disabled}`.
 *
 * The selected state is a 20px circle with a 6px active-500 stroke over a
 * white fill, which reads as an indigo ring around a white centre dot. That
 * is reproduced with a 6px border rather than an inner element, so the dot
 * cannot drift out of alignment at any size.
 *
 *   design light / dark        token
 *   #f5f5f5 / #26282a          surface         unselected
 *   #eeeeee / #2e3133          surface-muted   disabled
 *   #595fe5                    active-500      selected ring, both themes
 *   #ffffff                    white           selected centre, both themes
 *   #1b1d1f / #ffffff          fg              label
 *   #9da2a7 / #55585a          fg-subtle       disabled label
 *
 * As with Checkbox, the hover stroke is the one value with no paired token:
 * active-300 in light, active-900 in dark.
 */
export const radioVariants = cva(
  [
    "peer relative inline-flex shrink-0 items-center justify-center",
    "rounded-full",
    "outline-none",
    "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
    "motion-reduce:transition-none",
    // A transparent border is always present so the hover ring never reflows.
    "border border-transparent bg-surface",
    "hover:border-active-300 dark:hover:border-active-900",
    "focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-canvas",
    // Selected: thick ring over a white centre.
    "data-[state=checked]:border-[6px] data-[state=checked]:border-active-500",
    "data-[state=checked]:bg-white",
    "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-muted",
    "disabled:data-[state=checked]:border-[6px]",
    "disabled:data-[state=checked]:border-border-strong",
    "disabled:data-[state=checked]:bg-surface-muted",
    "not-disabled:cursor-pointer",
  ],
  {
    variants: {
      size: {
        sm: "size-4 data-[state=checked]:border-[5px]",
        md: "size-5",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type RadioVariantProps = VariantProps<typeof radioVariants>;
