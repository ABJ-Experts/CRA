import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  cardHeaderVariants,
  cardTitleVariants,
  cardVariants,
  type CardVariantProps,
} from "./card.variants";

/**
 * Card - the chrome shared by every card in Pencil frame `qK67c`.
 *
 * Deliberately has no `"use client"`: this is layout, and cards wrap static
 * content on server-rendered pages far more often than not. That rules out
 * React Context for passing `size`/`variant` down to the sub-parts, since
 * context cannot be read in a Server Component at all. The Card instead
 * publishes `data-card-size` / `data-card-variant`, and the sub-parts key off
 * those with CSS ancestor selectors - same result, no JS, no client boundary.
 *
 * ```tsx
 * <Card>
 *   <CardHeader action={<Button variant="invisible" tone="grey">View</Button>}>
 *     <CardTitle>Audiences</CardTitle>
 *   </CardHeader>
 *   <CardBody>...</CardBody>
 * </Card>
 * ```
 */

export interface CardProps
  extends Omit<ComponentProps<"div">, "title">, Omit<CardVariantProps, "interactive"> {
  /**
   * Render the child element instead of a `<div>` - use it to make the whole
   * card a link or button. Pair with `interactive`.
   */
  asChild?: boolean;
  /** Hover lift and a focus ring. Only meaningful when the card is clickable. */
  interactive?: boolean;
}

export function Card({
  variant = "outlined",
  size = "md",
  interactive = false,
  asChild = false,
  className,
  ...props
}: CardProps) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      data-card-size={size}
      data-card-variant={variant}
      className={cn(cardVariants({ variant, size, interactive }), className)}
      {...props}
    />
  );
}

export interface CardHeaderProps extends ComponentProps<"div"> {
  /** Right-hand slot: a menu, a legend, a date range. */
  action?: ReactNode;
}

export function CardHeader({ action, className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(cardHeaderVariants(), "[[data-card-size=sm]_&]:gap-4", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export interface CardTitleProps extends ComponentProps<"h3"> {
  asChild?: boolean;
}

export function CardTitle({ asChild = false, className, ...props }: CardTitleProps) {
  const Comp = asChild ? Slot : "h3";
  return (
    <Comp
      className={cn(
        cardTitleVariants(),
        // 16px SemiBold at `md`, 14px at `sm`, per Summary and Coin.
        "[[data-card-size=sm]_&]:text-subhead-semibold",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-caption-1-regular text-fg-muted",
        // On a `primary` card the surface is `active-500`, where `fg-muted`
        // is nearly invisible. White at reduced opacity keeps the hierarchy
        // without inventing a token that only works on one surface.
        "[[data-card-variant=primary]_&]:text-white/70",
        className,
      )}
      {...props}
    />
  );
}

export interface CardBodyProps extends ComponentProps<"div"> {
  /**
   * Make the body scroll and fade its bottom edge, reproducing the "Hide
   * Scroll" gradient on the Recent Activity card.
   */
  scrollable?: boolean;
  /**
   * Surface the fade blends into. Defaults to `canvas`, which is right for
   * the `outlined` variant; pass `surface` inside a `filled` card. The
   * gradient has to be a concrete colour, so this cannot be inherited from
   * the data attribute the way the type scale is.
   */
  fadeOn?: "canvas" | "surface";
}

export function CardBody({
  scrollable = false,
  fadeOn = "canvas",
  className,
  children,
  ...props
}: CardBodyProps) {
  if (!scrollable) {
    return (
      <div className={cn("min-w-0 flex-1", className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("relative min-h-0 flex-1", className)} {...props}>
      <div className="size-full overflow-y-auto overscroll-contain">{children}</div>
      {/*
        The frame draws this as a transparent-to-surface gradient rectangle
        pinned to the bottom with the card's own bottom radius.
        `pointer-events-none` is essential: without it the fade would swallow
        clicks on whatever row it covers.
      */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-xl",
          fadeOn === "surface" ? "bg-grad-fade-surface" : "bg-grad-fade-canvas",
        )}
      />
    </div>
  );
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 items-center gap-2", className)} {...props} />;
}
