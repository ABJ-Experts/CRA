import { cn } from "@repo/ui/cn";

/**
 * The 960px decorative panel from the Admin Authorization frames.
 *
 * Measured from `a1za5` -> `Nd2TN` (and its dark twin `IBYQC` -> `LJd4A`):
 *
 *   backdrop   #eeeeee / #2e3133 -> `surface-muted`
 *   sheet A    843.95x897.58 @(309.99,-74.50) rot 30
 *              light white 49% -> #f0f3fd, dark #35383c -> #262940
 *   sheet B    1549.85x1549.85 @(919.53,-33) rot -45
 *              light white     -> #a7b3d7, dark #35383c -> #262940
 *   circles    brink-red-500 239 @(45,219), 63 @(-32,850)
 *              active-500    101 @(635,140)
 *   product    859x659 @(120,365)
 *
 * Authored as one inline SVG on the frame's own 960x1024 viewBox rather than
 * as positioned divs, so every coordinate stays the design's own and the
 * composition cannot distort.
 *
 * `meet`, NOT `slice`. The design panel is 0.94 wide-to-tall; in a real
 * browser it is whatever is left beside the 480px form column, typically
 * around 1.5. Under `slice` that difference scales the scene 1.5x and crops
 * it to 631 of its 1024 rows, so most of the artwork is simply gone and it
 * looks different at every window size. `meet` fits the whole scene instead,
 * so it is always the design's composition, only scaled.
 *
 * What `meet` normally costs is letterboxing. That is avoided by drawing the
 * backdrop and both gradient sheets far outside the viewBox: an outer <svg>
 * clips to its VIEWPORT, not its viewBox, so the overflow paints into the
 * bands and the panel still fills edge to edge. Enlarging the sheets is safe
 * because each is rotated about its own top-left, so growing it extends the
 * far edges while the diagonal through the anchor stays exactly where the
 * design put it.
 *
 * Inline (not a file) so it can re-theme: the backdrop reads
 * `--color-surface-muted`, and both sheets carry a `dark:` stop override. Only
 * the three circles are genuinely the same hex in both frames, so those are
 * the only literals here, and each is an existing token's value.
 *
 * The product shot is the piece meant to be swapped: replace
 * `public/auth/product.svg`, or pass `image`.
 */

export interface AuthArtProps {
  /** Product screenshot. Pass `null` to render the composition alone. */
  image?: string | null;
  /** Dark-theme screenshot. Falls back to `image` when omitted. */
  imageDark?: string | null;
  className?: string;
}

export function AuthArt({
  image = "/auth/product.svg",
  imageDark = "/auth/product-dark.svg",
  className,
}: AuthArtProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 960 1024"
      preserveAspectRatio="xMidYMid meet"
      className={cn("pointer-events-none size-full", className)}
    >
      <defs>
        {/*
          Styled through classes rather than `stopColor`, because the two
          sheets are the one part of the composition that is NOT shared between
          the frames: in dark both collapse to the same #35383c -> #262940, so
          the diagonal reads as a fold in the backdrop instead of a pale sheet
          laid over it. A `dark:` variant is the only way to reach a <stop>,
          which takes `stop-color`, not `fill`.
        */}
        <linearGradient id="auth-sheet-a" x1="0" y1="1" x2="0.55" y2="0">
          <stop
            offset="0"
            className="[stop-color:#ffffff] [stop-opacity:0.49] dark:[stop-color:#35383c] dark:[stop-opacity:1]"
          />
          <stop offset="1" className="[stop-color:#f0f3fd] dark:[stop-color:#262940]" />
        </linearGradient>
        <linearGradient id="auth-sheet-b" x1="0" y1="1" x2="0.55" y2="0">
          <stop offset="0" className="[stop-color:#ffffff] dark:[stop-color:#35383c]" />
          <stop offset="1" className="[stop-color:#a7b3d7] dark:[stop-color:#262940]" />
        </linearGradient>
        <clipPath id="auth-product-clip">
          <rect x="120" y="365" width="859" height="659" rx="12" />
        </clipPath>
      </defs>

      {/* Deliberately far larger than the viewBox so it fills the letterbox
          bands `meet` leaves at either side. */}
      <rect x="-3000" y="-3000" width="7000" height="7000" fill="var(--color-surface-muted)" />

      {/*
        Pencil rotates counter-clockwise about the top-left; SVG rotates
        clockwise, so both angles are negated.
        Sizes are the design's multiplied by 3, which extends the far edges
        off-canvas without moving the diagonal through the anchor.
      */}
      <rect
        x="309.99"
        y="-74.5"
        width="2531.85"
        height="2692.74"
        fill="url(#auth-sheet-a)"
        transform="rotate(-30 309.99 -74.5)"
      />
      <rect
        x="919.53"
        y="-33"
        width="4649.55"
        height="4649.55"
        fill="url(#auth-sheet-b)"
        transform="rotate(45 919.53 -33)"
      />

      <circle cx="164.5" cy="338.5" r="119.5" fill="var(--color-brink-red-500)" />
      <circle cx="-0.5" cy="881.5" r="31.5" fill="var(--color-brink-red-500)" />
      <circle cx="685.5" cy="190.5" r="50.5" fill="var(--color-active-500)" />

      {/*
        An external <image> cannot read this document's CSS, so a single file
        would stay light-on-dark. Both are rendered and the `dark:` variant
        swaps which one is visible.
      */}
      {image ? (
        <g clipPath="url(#auth-product-clip)">
          <image
            href={image}
            x="120"
            y="365"
            width="859"
            height="659"
            preserveAspectRatio="xMidYMin slice"
            className="dark:hidden"
          />
          <image
            href={imageDark ?? image}
            x="120"
            y="365"
            width="859"
            height="659"
            preserveAspectRatio="xMidYMin slice"
            className="hidden dark:block"
          />
        </g>
      ) : null}
    </svg>
  );
}
