import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Typography tokens from @repo/design-system that compile to `text-*`.
 *
 * These MUST be registered as font-size classes. Out of the box tailwind-merge
 * only knows Tailwind's own scale (xs, sm, base, ...), so it classifies
 * `text-h3` as a text COLOR. It would then treat `text-h3 text-fg` as two
 * colors, drop the first, and silently lose the font size.
 *
 * The three composites are `@utility` rules rather than theme keys, but they
 * emit font-size too, so they belong in the same group.
 */
const FONT_SIZES = [
  "body",
  "h3",
  "h4",
  "h5",
  "h6",
  "headline-medium",
  "headline-semibold",
  "subhead-regular",
  "subhead-medium",
  "subhead-semibold",
  "subhead-underline",
  "caption-1-regular",
  "caption-1-medium",
  "caption-1-semibold",
  "caption-1-uppercase",
  "caption-2-regular",
  "caption-2-semibold",
  "caption-2-uppercase",
  "os-system-sm",
  "os-system-md",
  "os-system-xl",
] as const;

/** Gradient utilities: `bg-grad-*` sets background-image, like `bg-linear-*`. */
const GRADIENTS = [
  "fade-canvas",
  "fade-surface",
  "neutral-light-hide-500",
  "neutral-light-hide-50",
  "neutral-dark-hide-500",
  "neutral-dark-hide-50",
  "glow-brink-red",
  "glow-origin-green",
  "glow-cyan-blue",
  "glow-royal-purple",
  "caramel",
  "yellow",
  "angry",
  "grey",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      "bg-image": [{ "bg-grad": [...GRADIENTS] }],
    },
  },
});

/**
 * Merge class names, with later Tailwind utilities winning over earlier ones.
 *
 * This is what makes a consumer's `className` override a component's own
 * variant classes instead of depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
