import { cva, type VariantProps } from "class-variance-authority";

/**
 * Switch variants, transcribed from the Pencil design file.
 *
 * Source frame: WSheb (Toogle). Pencil encodes
 * `State={Default|Active|Disabled}, Dark Mode={Off|On}`.
 *
 * Geometry is taken from the design's 24x24 icon: the track is 20x16 inset at
 * (2,4), fully rounded, with a circular knob. `sm` reproduces that exactly.
 *
 * DELIBERATE DEVIATION, flagged rather than silently applied:
 * the design draws this control as a single-colour Iconsax glyph filled
 * #1b1d1f in BOTH themes and BOTH states. On the dark canvas (#1b1d1f) the
 * track is therefore invisible, and "on" is indistinguishable from "off" by
 * colour. Reproducing that literally would ship an unusable control, so:
 *
 *   off    track = border-strong  (light #c6c8cb / dark #3e4043) - visible in both
 *   on     track = active-500     - consistent with Checkbox, Radio and focus rings
 *   knob   canvas                 - white on light, matching the design's white knob
 *
 * Everything else, including sizing, label typography and disabled treatment,
 * follows the design exactly.
 */
export const switchTrackVariants = cva(
  [
    "peer relative inline-flex shrink-0 items-center",
    "rounded-full",
    "outline-none",
    "transition-colors duration-200 ease-out",
    "motion-reduce:transition-none",
    "focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-canvas",
    "bg-border-strong",
    "data-[state=checked]:bg-active-500",
    "disabled:cursor-not-allowed disabled:bg-surface-muted",
    "disabled:data-[state=checked]:bg-surface-muted",
    "not-disabled:cursor-pointer",
  ],
  {
    variants: {
      size: {
        // Exactly the design's 20x16 track.
        sm: "h-4 w-5 p-0.5",
        // Larger, easier target for touch. Same proportions.
        md: "h-6 w-11 p-0.5",
      },
    },
    defaultVariants: { size: "sm" },
  }
);

export const switchThumbVariants = cva(
  [
    "pointer-events-none block rounded-full bg-canvas",
    "shadow-sm ring-0",
    // Tailwind v4 compiles `translate-x-*` to the `translate` property, NOT
    // `transform`. Transitioning `transform` here would silently do nothing
    // and the knob would jump instead of sliding.
    "transition-[translate] duration-200 ease-out",
    "motion-reduce:transition-none",
  ],
  {
    variants: {
      size: {
        // 20 - 12 - (2 * 2) = 4px of travel.
        sm: "size-3 data-[state=checked]:translate-x-1",
        // 44 - 20 - (2 * 2) = 20px of travel.
        md: "size-5 data-[state=checked]:translate-x-5",
      },
    },
    defaultVariants: { size: "sm" },
  }
);

export type SwitchVariantProps = VariantProps<typeof switchTrackVariants>;
