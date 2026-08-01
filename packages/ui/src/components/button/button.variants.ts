import { cva, type VariantProps } from "class-variance-authority";

/**
 * Button variants, transcribed from the Pencil design file.
 *
 * Source frames: qSF8l (Medium), e6qub (Small), jeUNn (Large), ApysM (Iconic).
 * Pencil encodes the matrix in its layer names:
 *   Dark Mode={Off|On} x Type={Fill|Outline|Gap|Invisible|Balloon}
 *   x Color={Primary|Sub-Primary|Grey|White} x State={Default|Hover & Clicked|Disabled}
 *
 * Every colour below resolves to a @repo/design-system token. Nothing is
 * hardcoded. Where the design's light and dark values differ, a semantic
 * token already carries both, so no `dark:` variant is needed:
 *
 *   design light / dark          token
 *   #eeeeee / #2e3133            border
 *   #c6c8cb / #3e4043            border-strong
 *   #f5f5f5 / #26282a            surface
 *   #eeeeee / #2e3133            surface-muted
 *   #727880 / #898f96            fg-muted
 *   #ebecff / #232445            accent-subtle
 *   #ffffff / #1b1d1f            canvas
 *
 * Geometry is exact: cornerRadius 12 on every variant (= rounded-xl).
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center",
    "rounded-xl",
    "select-none whitespace-nowrap",
    "outline-none",
    // The design has no focus state, but keyboard users need one. Uses the
    // brand accent and only shows for keyboard focus, so pointer users see
    // exactly what the design specifies.
    "focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-canvas",
    "transition-[background-color,border-color,color,opacity] duration-150 ease-out",
    "motion-reduce:transition-none",
    "disabled:cursor-not-allowed",
    // Buttons are `cursor: default` in Tailwind v4 Preflight, and Docusaurus
    // runs without Preflight at all. Set it explicitly so both apps agree.
    "not-disabled:cursor-pointer",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        fill: "",
        outline: "border",
        gap: "border",
        invisible: "bg-transparent",
        balloon: "rounded-[40px_40px_12px_40px]",
      },
      tone: {
        primary: "",
        subPrimary: "",
        grey: "",
        white: "",
      },
      size: {
        sm: "h-8 gap-1 px-3 py-[7px] text-caption-1-semibold [&_svg]:size-3",
        md: "h-10 gap-2 px-4 pt-[10px] pb-[9px] text-subhead-semibold [&_svg]:size-4",
        lg: "h-12 gap-3 px-6 py-3 text-headline-semibold [&_svg]:size-4",
      },
      iconOnly: { true: "", false: "" },
      fullWidth: { true: "w-full", false: "" },
    },

    compoundVariants: [
      /* ---------------------------------------------------------- Fill */
      {
        variant: "fill",
        tone: "primary",
        class: [
          "bg-active-500 text-white",
          "hover:bg-active-600 active:bg-active-600",
          "disabled:bg-border-strong disabled:text-canvas",
        ],
      },
      {
        variant: "fill",
        tone: "subPrimary",
        class: [
          "bg-accent-subtle text-active-500",
          "hover:bg-active-100 active:bg-active-100",
          "dark:hover:bg-active-900 dark:active:bg-active-900",
          "disabled:bg-border-strong disabled:text-canvas",
        ],
      },
      {
        variant: "fill",
        tone: "grey",
        class: [
          "bg-surface text-fg-muted",
          "hover:bg-surface-muted active:bg-surface-muted",
          "disabled:bg-border-strong disabled:text-canvas",
        ],
      },
      {
        variant: "fill",
        tone: "white",
        class: [
          "bg-white text-neutral-light-500",
          "hover:bg-neutral-light-50 active:bg-neutral-light-50",
          "disabled:bg-border-strong disabled:text-canvas",
        ],
      },

      /* ------------------------------------------------------- Outline */
      // Outline and Gap differ only in border colour: nl-100 vs nl-200.
      {
        variant: "outline",
        tone: "grey",
        class: [
          "border-border text-fg-muted",
          "hover:bg-surface active:bg-surface",
          "disabled:border-transparent disabled:bg-border-strong disabled:text-canvas",
        ],
      },
      {
        variant: "outline",
        tone: "primary",
        class: [
          "border-border bg-canvas text-active-500",
          "hover:bg-surface active:bg-surface",
          "disabled:border-transparent disabled:bg-border-strong disabled:text-canvas",
        ],
      },
      {
        variant: "outline",
        tone: "white",
        class: [
          "border-white text-white",
          "hover:bg-scrim-white-15 active:bg-scrim-white-15",
          "disabled:border-transparent disabled:bg-border-strong disabled:text-canvas",
        ],
      },

      /* ----------------------------------------------------------- Gap */
      {
        variant: "gap",
        tone: "grey",
        class: [
          "border-border-strong text-fg-muted",
          "hover:bg-surface active:bg-surface",
          "disabled:border-transparent disabled:bg-border-strong disabled:text-canvas",
        ],
      },

      /* ----------------------------------------------------- Invisible */
      // Smaller footprint in the design: padding collapses and height shrinks.
      {
        variant: "invisible",
        tone: "primary",
        class: [
          "text-active-500",
          "hover:bg-accent-subtle active:bg-accent-subtle",
          "disabled:bg-transparent disabled:text-border-strong",
        ],
      },
      {
        variant: "invisible",
        tone: "grey",
        class: [
          "text-fg-muted",
          "hover:bg-surface active:bg-surface",
          "disabled:bg-transparent disabled:text-border-strong",
        ],
      },
      { variant: "invisible", size: "sm", iconOnly: false, class: "h-[22px] gap-1 p-0.5" },
      { variant: "invisible", size: "md", iconOnly: false, class: "h-6 gap-1 px-0.5 pt-0.5 pb-px" },
      { variant: "invisible", size: "lg", iconOnly: false, class: "h-7 gap-2 p-1" },

      /* ------------------------------------------------------- Balloon */
      {
        variant: "balloon",
        class: [
          "bg-active-500 text-white",
          "hover:bg-active-600 active:bg-active-600",
          "disabled:bg-border-strong disabled:text-canvas",
        ],
      },

      /* -------------------------------------------------------- Iconic */
      // Square, no label. Pencil: 32/48/64 with padding 4/12/16.
      { iconOnly: true, size: "sm", class: "size-8 gap-0 p-1 [&_svg]:size-4" },
      { iconOnly: true, size: "md", class: "size-12 gap-0 p-3 [&_svg]:size-6" },
      { iconOnly: true, size: "lg", class: "size-16 gap-0 p-4 [&_svg]:size-8" },
    ],

    defaultVariants: {
      variant: "fill",
      tone: "primary",
      size: "md",
      iconOnly: false,
      fullWidth: false,
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
