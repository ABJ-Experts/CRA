"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { BadgeCheck, User } from "lucide-react";
import { Children, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  avatarStatusVariants,
  avatarSurfaceVariants,
  avatarVariants,
  avatarVerifiedVariants,
  type AvatarVariantProps,
} from "./avatar.variants";

/**
 * Avatar - Pencil frame `hHuuw`.
 *
 * Built on Radix Avatar so a broken or slow image falls back to initials
 * rather than showing a broken-image glyph, and so the fallback does not
 * flash before a cached image paints.
 *
 * ```tsx
 * <Avatar name="Ada Foster" src="/ada.jpg" status="online" />
 * <Avatar name="Ada Foster" size="lg" verified />
 * <Avatar images={["/a.jpg", "/b.jpg"]} />   // the frame's "2 Image" type
 * ```
 */

export type AvatarSize = NonNullable<AvatarVariantProps["size"]>;
export type AvatarStatus = "online" | "busy" | "away" | "offline";

/** "Ada Foster" -> "AF". A single word falls back to its first two letters. */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  const first = (words[0] as string)[0] ?? "";
  const last = (words[words.length - 1] as string)[0] ?? "";
  return (first + last).toUpperCase();
}

export interface AvatarProps extends Omit<ComponentProps<"span">, "children"> {
  size?: AvatarSize;
  src?: string;
  /**
   * Person's name. Used for the initials fallback and, unless `alt` is given,
   * as the image's alternative text.
   */
  name?: string;
  alt?: string;
  /** Overrides the derived initials. */
  initials?: string;
  /** Shown when there is neither an image nor a name. */
  fallback?: ReactNode;
  /** Presence dot. Shares the bottom-right corner with `verified`. */
  status?: AvatarStatus;
  /** Verified tick. Shares the bottom-right corner with `status`. */
  verified?: boolean;
  /** The frame's "Stories" ring. */
  ring?: boolean;
  /**
   * The frame's `2 Image` / `3 Image` types: two or three photos clustered
   * inside one slot. More than three are ignored - use `AvatarGroup` for a
   * row of separate people.
   */
  images?: string[];
}

/**
 * Geometry for the clustered types, as fractions of the box so they hold at
 * every size. From the Small frame: 32px children at (0,0) and (16,16) for
 * two; 28px children at (0,0), (10,20) and (20,0) for three.
 */
const CLUSTER = {
  2: { scale: 32 / 48, at: [[0, 0], [16 / 48, 16 / 48]] },
  3: {
    scale: 28 / 48,
    at: [[0, 0], [10 / 48, 20 / 48], [20 / 48, 0]],
  },
} as const;

export function Avatar({
  size = "sm",
  src,
  name,
  alt,
  initials,
  fallback,
  status,
  verified = false,
  ring = false,
  images,
  className,
  ...props
}: AvatarProps) {
  const text = initials ?? (name ? initialsFrom(name) : "");
  const cluster = images && images.length >= 2 ? CLUSTER[images.length >= 3 ? 3 : 2] : null;

  return (
    <span
      className={cn(
        avatarVariants({ size }),
        // `outline` rather than `ring`, so the Stories circle is drawn without
        // changing the layout box - the frame's ring shares the avatar's
        // diameter rather than growing it.
        ring && "outline-2 outline-brink-red-500",
        className
      )}
      {...props}
    >
      {cluster ? (
        <span className="relative size-full">
          {(images ?? []).slice(0, 3).map((imgSrc, i) => {
            const [x, y] = cluster.at[i] ?? [0, 0];
            return (
              <AvatarPrimitive.Root
                key={`${imgSrc}-${i}`}
                className={cn(
                  "absolute overflow-hidden rounded-full bg-origin-orange-300",
                  // The white separator in the frame becomes `canvas`, so
                  // overlapping circles stay separated on a dark page too.
                  i > 0 && "outline-2 outline-canvas"
                )}
                style={{
                  width: `${cluster.scale * 100}%`,
                  height: `${cluster.scale * 100}%`,
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                }}
              >
                <AvatarPrimitive.Image
                  src={imgSrc}
                  alt=""
                  className="size-full object-cover"
                />
                <AvatarPrimitive.Fallback className="flex size-full items-center justify-center">
                  <User aria-hidden="true" className="size-1/2 text-neutral-light-500" />
                </AvatarPrimitive.Fallback>
              </AvatarPrimitive.Root>
            );
          })}
        </span>
      ) : (
        <AvatarPrimitive.Root className={avatarSurfaceVariants({ size })}>
          {src ? (
            <AvatarPrimitive.Image
              src={src}
              alt={alt ?? name ?? ""}
              className="size-full object-cover"
            />
          ) : null}
          <AvatarPrimitive.Fallback
            // No delay: the fallback is the design's own "Default Text" state,
            // not a loading placeholder, so it should be there immediately
            // when there is no `src` at all.
            delayMs={src ? 200 : 0}
            className="flex size-full items-center justify-center text-neutral-light-500"
          >
            {text ? (
              text
            ) : (
              (fallback ?? <User aria-hidden="true" className="size-1/2" />)
            )}
          </AvatarPrimitive.Fallback>
        </AvatarPrimitive.Root>
      )}

      {status ? (
        <span
          className={avatarStatusVariants({ size, status })}
          role="img"
          aria-label={`${name ? `${name}: ` : ""}${status}`}
        />
      ) : verified ? (
        <span className={avatarVerifiedVariants({ size })}>
          <BadgeCheck
            aria-label="Verified"
            role="img"
            className="size-full fill-verified text-canvas"
            strokeWidth={2}
          />
        </span>
      ) : null}
    </span>
  );
}

export interface AvatarGroupProps extends ComponentProps<"div"> {
  size?: AvatarSize;
  /** Show at most this many, then a "+N" bubble. */
  max?: number;
  /** Total people, when more exist than were passed as children. */
  total?: number;
}

/**
 * A row of overlapping avatars with an overflow count.
 *
 * The frame's `More` layer - a dark circle with "9+" - is the same idea, so
 * the overflow bubble reuses it: `#000000` at 14px Medium in white.
 */
export function AvatarGroup({
  size = "sm",
  max = 4,
  total,
  className,
  children,
  ...props
}: AvatarGroupProps) {
  const items = Children.toArray(children);
  const shown = items.slice(0, max);
  const hidden = Math.max(0, (total ?? items.length) - shown.length);

  return (
    <div
      className={cn(
        "flex items-center",
        // Overlap by exactly a third of the box, matching how the frame's
        // clustered types offset their children.
        size === "sm" && "-space-x-4",
        size === "md" && "-space-x-[1.6667rem]",
        size === "lg" && "-space-x-10",
        // A `canvas` outline on each circle keeps the stack legible. The
        // frame uses white; `canvas` is the same in light mode and avoids a
        // bright halo on a dark page.
        "[&>*]:outline-2 [&>*]:outline-canvas",
        className
      )}
      {...props}
    >
      {shown}
      {hidden > 0 ? (
        <span
          className={cn(
            avatarVariants({ size }),
            // The frame's `More` layer is black with white text, but there it
            // is an overlay ON an avatar, so it always has something to read
            // against. This bubble stands on the page instead: fixed black
            // would vanish into the dark canvas. Inverting against `fg` /
            // `canvas` reproduces the design exactly in light mode and stays
            // legible in dark - the same treatment the current page gets in
            // Pagination.
            "bg-fg text-canvas",
            size === "sm" && "text-subhead-medium",
            size === "md" && "text-h5",
            size === "lg" && "text-h3"
          )}
          aria-label={`${hidden} more`}
          role="img"
        >
          {hidden > 9 ? "9+" : `+${hidden}`}
        </span>
      ) : null}
    </div>
  );
}
