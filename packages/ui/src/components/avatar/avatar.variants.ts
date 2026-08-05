import { cva, type VariantProps } from "class-variance-authority";

/**
 * Avatar - Pencil frame `hHuuw` ("User Avatar").
 *
 * Axes: `State={Default Text|Default image|Image} x Size={Small|Medium|Large}
 * x Type={Default|2 Image|3 Image}`.
 *
 * Measured:
 *
 * | Size | box | initials      | online dot | verify tag  |
 * | ---- | --- | ------------- | ---------- | ----------- |
 * | sm   | 48  | 14px Medium   | 10, ring 2 | 16, r 12    |
 * | md   | 80  | 20px Medium   | 16, ring 2 | 16, r 12    |
 * | lg   | 120 | 34px Medium   | 24, ring 3 | 36, r 16    |
 *
 * Both badges sit flush in the bottom-right corner: their x/y equals the box
 * size minus the badge size at every size, so they are `bottom-0 right-0`
 * rather than needing a per-size offset.
 *
 * The initials fallback is `#ffc9ac` (`origin-orange-300`) with `#1b1d1f`
 * text. That ink does NOT flip with the theme, and should not: the pastel
 * stays light in both, exactly like the Tag's Fill Color variant.
 *
 * Decorations ship disabled in the frame - Stories, Border, More and Verify
 * are all `enabled: false`, Online is on - so they are opt-in props here.
 */

export const avatarVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center",
    "rounded-full",
    // Never let a wide image or long initials break the circle.
    "overflow-visible",
    "select-none",
  ].join(" "),
  {
    variants: {
      size: {
        sm: "size-12",
        md: "size-20",
        lg: "size-30",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

/** The circle itself: image, initials or placeholder all share this box. */
export const avatarSurfaceVariants = cva(
  "flex size-full items-center justify-center overflow-hidden rounded-full bg-origin-orange-300",
  {
    variants: {
      size: {
        sm: "text-subhead-medium",
        md: "text-h5",
        lg: "text-h3",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

/**
 * Presence dot. The design's 2px (3px at `lg`) ring is white; it uses
 * `canvas` here so the dot still reads as detached from the avatar on a dark
 * page instead of gaining a bright halo.
 */
export const avatarStatusVariants = cva("absolute right-0 bottom-0 rounded-full ring-canvas", {
  variants: {
    size: {
      sm: "size-2.5 ring-2",
      md: "size-4 ring-2",
      lg: "size-6 ring-[3px]",
    },
    status: {
      online: "bg-origin-green-500",
      busy: "bg-brink-red-500",
      away: "bg-origin-orange-500",
      offline: "bg-neutral-light-300",
    },
  },
  defaultVariants: { size: "sm", status: "online" },
});

/**
 * Verified tick. Only `online` is enabled in the frame, and the two badges
 * occupy the same corner, so a component showing both would stack them - the
 * component treats them as mutually exclusive and documents it.
 */
export const avatarVerifiedVariants = cva(
  "absolute right-0 bottom-0 flex items-center justify-center rounded-full bg-canvas",
  {
    variants: {
      size: {
        sm: "size-4",
        md: "size-4",
        lg: "size-9",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

export type AvatarVariantProps = VariantProps<typeof avatarVariants>;
