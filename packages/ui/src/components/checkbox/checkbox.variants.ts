import { cva, type VariantProps } from "class-variance-authority";

/**
 * Checkbox variants, transcribed from the Pencil design file.
 *
 * Source frame: R00jx (Checkbox). Pencil encodes
 * `Dark Mode={Off|On}, State={Default|Hover|Active|Disabled}`.
 *
 * Box is 20x20 with cornerRadius 6 (= rounded-md), gap 8 to the label.
 *
 *   design light / dark        token
 *   #f5f5f5 / #26282a          surface         unchecked box
 *   #eeeeee / #2e3133          surface-muted   disabled box
 *   #595fe5                    active-500      checked box, both themes
 *   #1b1d1f / #ffffff          fg              label
 *   #9da2a7 / #55585a          fg-subtle       disabled label
 *
 * The hover stroke is the one value with no single token: the design uses
 * active-300 in light and active-900 in dark, which no semantic token pairs
 * that way, so it is expressed with an explicit `dark:` variant.
 */
export const checkboxVariants = cva(
  [
    "peer relative inline-flex shrink-0 items-center justify-center",
    "size-5 rounded-md",
    "outline-none",
    "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
    "motion-reduce:transition-none",
    // Border is always present so the hover stroke never shifts layout.
    "border border-transparent",
    "focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-canvas",
    // Unchecked
    "bg-surface",
    "hover:border-active-300 dark:hover:border-active-900",
    // Checked and indeterminate share the filled treatment
    "data-[state=checked]:bg-active-500 data-[state=checked]:border-transparent",
    "data-[state=indeterminate]:bg-active-500 data-[state=indeterminate]:border-transparent",
    // Disabled
    "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:border-transparent",
    "disabled:data-[state=checked]:bg-surface-muted",
    "disabled:data-[state=indeterminate]:bg-surface-muted",
    "not-disabled:cursor-pointer",
  ],
  {
    variants: {
      size: {
        // Pencil ships a single 20px size; sm is a considered addition for
        // dense rows such as table headers.
        sm: "size-4 rounded",
        md: "size-5 rounded-md",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type CheckboxVariantProps = VariantProps<typeof checkboxVariants>;
