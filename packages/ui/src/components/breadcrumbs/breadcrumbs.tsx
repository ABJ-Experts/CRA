"use client";

import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

/**
 * Breadcrumbs - Pencil frames `ZfeDR` (the crumb) and `S9VKAU` / `P9vz0z`
 * (the assembled bar).
 *
 * The crumb frame carries `Responsive={Desktop|Mobile}` and
 * `State={Default|Hover & Click|Disabled}`:
 *
 *   desktop   14px Regular -> `subhead-regular`
 *   mobile    12px Regular -> `caption-1-regular`
 *   default   #1b1d1f / #ffffff  -> `fg`
 *   hover     #595fe5            -> `active-500`
 *   disabled  #9da2a7 / #55585a  -> `fg-subtle`
 *
 * The assembled bar sets gap 8 between items and separates them with a 12px
 * linear chevron.
 *
 * Note the last crumb in the bar uses the same colour the component labels
 * "Disabled". It is not disabled - it is the current page: present, not
 * navigable. `current` renders it that way and marks it `aria-current="page"`,
 * while `disabled` is kept separate for a genuinely unavailable ancestor.
 *
 * ```tsx
 * <Breadcrumbs>
 *   <BreadcrumbItem asChild><Link href="/">Home</Link></BreadcrumbItem>
 *   <BreadcrumbItem asChild><Link href="/reports">Reports</Link></BreadcrumbItem>
 *   <BreadcrumbItem current>Q3</BreadcrumbItem>
 * </Breadcrumbs>
 * ```
 */

export interface BreadcrumbsProps extends Omit<ComponentProps<"nav">, "children"> {
  children: ReactNode;
  /**
   * Force a type scale. By default it is responsive, matching the design's
   * Mobile and Desktop variants: 12px under the `sm` breakpoint, 14px at and
   * above it.
   */
  size?: "sm" | "md";
  /**
   * Collapse the middle of a long trail behind an expandable ellipsis, always
   * keeping the first crumb and the last `itemsAfterCollapse`. Without this a
   * deep hierarchy either wraps onto several lines or scrolls sideways.
   */
  maxItems?: number;
  itemsBeforeCollapse?: number;
  itemsAfterCollapse?: number;
  /** Accessible name for the landmark. */
  label?: string;
  separator?: ReactNode;
}

export function Breadcrumbs({
  children,
  size,
  maxItems,
  itemsBeforeCollapse = 1,
  itemsAfterCollapse = 2,
  label = "Breadcrumb",
  separator,
  className,
  ...props
}: BreadcrumbsProps) {
  const [expanded, setExpanded] = useState(false);

  const items = Children.toArray(children).filter(isValidElement);

  // 12px in the frame, at every responsive variant.
  const sep = separator ?? (
    <ChevronRight
      aria-hidden="true"
      // The frame hardcodes the chevron to #1b1d1f, which disappears on the
      // dark canvas, so it follows a token here instead.
      className="size-3 shrink-0 text-fg-muted"
      strokeWidth={1.5}
    />
  );

  const collapse =
    maxItems !== undefined &&
    !expanded &&
    items.length > maxItems &&
    items.length > itemsBeforeCollapse + itemsAfterCollapse;

  const visible = collapse
    ? [
        ...items.slice(0, itemsBeforeCollapse),
        "ellipsis" as const,
        ...items.slice(items.length - itemsAfterCollapse),
      ]
    : items;

  return (
    <nav aria-label={label} className={cn("min-w-0", className)} {...props}>
      <ol
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2",
          size === "sm" && "text-caption-1-regular",
          size === "md" && "text-subhead-regular",
          // Responsive default: the design's Mobile scale below `sm`, Desktop
          // at and above it.
          size === undefined && "text-caption-1-regular sm:text-subhead-regular"
        )}
      >
        {visible.map((item, i) => (
          <Fragment key={item === "ellipsis" ? "ellipsis" : i}>
            {i > 0 ? <li aria-hidden="true" className="flex items-center">{sep}</li> : null}
            {item === "ellipsis" ? (
              <li className="flex items-center">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label={`Show ${items.length - itemsBeforeCollapse - itemsAfterCollapse} hidden breadcrumbs`}
                  className={cn(
                    "flex items-center rounded px-1 text-fg-muted",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    "hover:text-active-500",
                    "outline-none focus-visible:ring-2 focus-visible:ring-active-500"
                  )}
                >
                  <MoreHorizontal aria-hidden="true" className="size-4" />
                </button>
              </li>
            ) : (
              item
            )}
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

export interface BreadcrumbItemProps extends ComponentProps<"li"> {
  /**
   * Render the child element (a `<Link>`, an `<a>`) instead of a `<span>`.
   * Ignored when `current` or `disabled` is set, since neither should be
   * navigable - pass plain text for those.
   */
  asChild?: boolean;
  /** The page you are on: styled as the trail's end and not navigable. */
  current?: boolean;
  /** A genuinely unavailable ancestor. Distinct from `current`. */
  disabled?: boolean;
}

export function BreadcrumbItem({
  asChild = false,
  current = false,
  disabled = false,
  className,
  children,
  ...props
}: BreadcrumbItemProps) {
  const inert = current || disabled;
  const Comp = asChild && !inert ? Slot : "span";

  return (
    <li className="flex min-w-0 items-center" {...props}>
      <Comp
        aria-current={current ? "page" : undefined}
        aria-disabled={disabled || undefined}
        className={cn(
          "block max-w-[16ch] truncate rounded-sm sm:max-w-[24ch]",
          "transition-colors duration-150 motion-reduce:transition-none",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          inert
            ? "text-fg-subtle"
            : "cursor-pointer text-fg hover:text-active-500 active:text-active-500",
          disabled && "cursor-not-allowed",
          className
        )}
      >
        {children}
      </Comp>
    </li>
  );
}
