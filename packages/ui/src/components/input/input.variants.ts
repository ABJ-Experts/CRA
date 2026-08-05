import { cva, type VariantProps } from "class-variance-authority";

/**
 * Input variants, transcribed from the Pencil design file.
 *
 * Source frames: Onotz (Forms/Title, the large 56px field) and
 * oYjQl (Forms / Password, the standard 40px field with label and error).
 * Pencil encodes states as `Dark Mode={Off|On}, State={Default|Hover|Typing|
 * Active|Error|Disabled}`.
 *
 * Border strategy: the design uses a 1px stroke that becomes 2px on hover.
 * Swapping border-width would reflow the content by 1px, so every state is
 * drawn as an INSET BOX-SHADOW instead. That is pixel-identical, never shifts
 * layout, and keeps the box size stable across states.
 *
 * Every class below is written out in full. Tailwind scans source statically,
 * so a helper that assembles class strings at runtime would produce classes
 * that are never generated.
 *
 *   design light / dark        token
 *   #ffffff / #1b1d1f          canvas          field background
 *   #eeeeee / #2e3133          border          default stroke
 *   #ebecff / #232445          accent-subtle   hover stroke (2px)
 *   #595fe5 / #595fe5          active-500      focus stroke
 *   #e5646c / #e5646c          danger          error stroke
 *   #f5f5f5 / #26282a          surface         disabled background
 *   #c6c8cb / #3e4043          border-strong   placeholder
 *   #1b1d1f / #ffffff          fg              value
 *   #9da2a7 / #55585a          fg-subtle       disabled text
 *   #727880 / #898f96          fg-muted        label
 */
export const inputFieldVariants = cva(
  [
    "group/field relative flex w-full items-center",
    "rounded-xl bg-canvas",
    "transition-[box-shadow,background-color] duration-150 ease-out",
    "motion-reduce:transition-none",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      size: {
        // Pencil: 400x40, padding [10,12,9,12], gap 12, text 14/400.
        md: "h-10 gap-3 px-3 text-subhead-regular [&_svg]:size-4",
        // Pencil Admin Authorization (a1za5 et al): 360x48, padding
        // [14,12,13,12], gap 12, text 14/400. Same type scale as `md`, taller
        // box - the auth screens and the Select Users trigger both use it.
        lg: "h-12 gap-3 px-3 text-subhead-regular [&_svg]:size-4",
        // Pencil Forms/Title (jK37E): 400x56, padding [13,16], gap 12,
        // text 20/500.
        xl: "h-14 gap-3 px-4 text-h5 [&_svg]:size-5",
      },
      state: {
        // `inset-ring-*` is Tailwind v4's native inset box-shadow. It composes
        // through --tw-inset-ring-*, so it does not fight the shadow chain the
        // way an arbitrary `shadow-[inset_...]` value does.
        default: [
          "inset-ring-1 inset-ring-border",
          "hover:inset-ring-2 hover:inset-ring-accent-subtle",
          // Focus must beat hover while the pointer is still over the field.
          "focus-within:inset-ring-1 focus-within:inset-ring-active-500",
          "focus-within:hover:inset-ring-1 focus-within:hover:inset-ring-active-500",
        ].join(" "),
        error: [
          "inset-ring-1 inset-ring-danger",
          "hover:inset-ring-2 hover:inset-ring-danger",
          "focus-within:inset-ring-1 focus-within:hover:inset-ring-1",
        ].join(" "),
        disabled: "bg-surface inset-ring-0 cursor-not-allowed",
      },
    },
    defaultVariants: { size: "md", state: "default" },
  },
);

export const inputControlVariants = cva(
  [
    "min-w-0 flex-1 bg-transparent",
    "text-fg placeholder:text-border-strong",
    "border-0 p-0 outline-none",
    "disabled:cursor-not-allowed disabled:text-fg-subtle disabled:placeholder:text-fg-subtle",
  ],
  {
    variants: {
      size: {
        md: "text-subhead-regular",
        lg: "text-subhead-regular",
        xl: "text-h5",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type InputFieldVariantProps = VariantProps<typeof inputFieldVariants>;
