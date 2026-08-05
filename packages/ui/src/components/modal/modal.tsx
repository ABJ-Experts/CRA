"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Modal - Pencil frame `sjsNr`.
 *
 * The frame specifies the chrome (header and footer bars), not a fixed body,
 * because the body is whatever the feature puts in it. Measured:
 *
 *   surface        #ffffff / #1b1d1f  -> `canvas`  (note: NOT `elevated`)
 *   width          480, radius 12
 *
 *   header default 78 tall = 24 + 30 + 24, padding 24, radius 12 12 0 0
 *                  title 20px Medium -> `h5` + `fg`
 *                  close 32x32 r12 `surface`, pinned 8 from the top/right
 *                  optional step rail (shipped disabled in the frame)
 *
 *   header mailbox 48 tall, padding 12 12 12 16, gap 12
 *                  title 14px Medium -> `subhead-medium`
 *                  3 x 24x24 r12 icon buttons, gap 16
 *
 *   footer         88 tall = 24 + 40 + 24, padding 24, radius 0 0 12 12
 *                  left slot (optional destructive action / checkbox),
 *                  right actions gap 8
 *
 * Built on Radix Dialog: focus trap, ESC, outside-click dismissal, scroll
 * lock and the title/description associations come from the primitive.
 *
 * ```tsx
 * <ModalRoot>
 *   <ModalTrigger asChild><Button>Open</Button></ModalTrigger>
 *   <ModalContent>
 *     <ModalHeader><ModalTitle>Title</ModalTitle></ModalHeader>
 *     <ModalBody>...</ModalBody>
 *     <ModalFooter>
 *       <ModalClose asChild><Button variant="outline" tone="grey">Cancel</Button></ModalClose>
 *       <Button>Active</Button>
 *     </ModalFooter>
 *   </ModalContent>
 * </ModalRoot>
 * ```
 */

export const ModalRoot = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;
export const ModalPortal = DialogPrimitive.Portal;

/** Only 480 (`md`) is specified in the design; the rest keep its radius and
 * padding and just change the measure. */
const SIZES = {
  sm: "sm:w-100",
  md: "sm:w-120",
  lg: "sm:w-160",
  xl: "sm:w-200",
} as const;

export type ModalSize = keyof typeof SIZES;

export type ModalHeaderVariant = "default" | "mailbox";

/**
 * Lets `ModalTitle` pick its type scale (20px vs 14px) from the bar it sits
 * in, so a consumer never has to repeat the variant on the title.
 */
const ModalHeaderContext = createContext<ModalHeaderVariant>("default");

export type ModalOverlayProps = ComponentProps<typeof DialogPrimitive.Overlay>;

export function ModalOverlay({ className, ...props }: ModalOverlayProps) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-scrim-black-50",
        "data-[state=open]:animate-backdrop-in",
        // NO exit animation, deliberately.
        //
        // Radix mounts the scroll lock on the OVERLAY and keeps it mounted
        // until the exit animation fires `animationend`. If that event never
        // arrives - a backgrounded tab, a suspended compositor - the overlay
        // survives as a full-viewport opaque scrim that swallows every click
        // AND holds `data-scroll-locked` on <body>, leaving the page frozen
        // with no visible cause. Measured: overlay stuck at
        // `data-state=closed`, `opacity: 1`, page unscrollable.
        //
        // Unmounting synchronously removes that entire failure class. The
        // panel keeps its 120ms scale-out, which is what the eye tracks; the
        // backdrop simply leaves with it.
        "data-[state=closed]:animate-none",
        "motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export interface ModalContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: ModalSize;
}

export function ModalContent({ size = "md", className, children, ...props }: ModalContentProps) {
  return (
    <ModalPortal>
      <ModalOverlay />
      {/*
        Centred by this flex wrapper rather than `top-1/2 -translate-y-1/2`:
        Tailwind v4 compiles `-translate-*` to the `translate` property, and a
        keyframe animating `translate` would overwrite the centring offset.
        The wrapper's padding also keeps the panel off the viewport edges.
      */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Content
          className={cn(
            "flex w-full flex-col overflow-hidden",
            // Full-bleed measure below `sm`, the design's width above it.
            SIZES[size],
            // The panel never outgrows the viewport; ModalBody scrolls instead.
            "max-h-[calc(100dvh-2rem)]",
            "rounded-xl bg-canvas",
            "shadow-lg shadow-scrim-black-30",
            "outline-none",
            "data-[state=open]:animate-dialog-in",
            "data-[state=closed]:animate-dialog-out",
            "motion-reduce:animate-none",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </ModalPortal>
  );
}

export interface ModalHeaderProps extends ComponentProps<"div"> {
  /** `default` is the 78px title bar; `mailbox` the 48px compose bar. */
  variant?: ModalHeaderVariant;
  /** Render the close control. */
  showClose?: boolean;
  /** Accessible name for the close control. */
  closeLabel?: string;
  /** `mailbox` only: the icon buttons on the right, e.g. minimise / expand. */
  actions?: ReactNode;
}

export function ModalHeader({
  variant = "default",
  showClose = true,
  closeLabel = "Close",
  actions,
  className,
  children,
  ...props
}: ModalHeaderProps) {
  if (variant === "mailbox") {
    return (
      <ModalHeaderContext.Provider value="mailbox">
        <div
          data-variant="mailbox"
          className={cn(
            "flex shrink-0 items-center gap-3 py-3 pr-3 pl-4",
            "rounded-t-xl bg-canvas",
            className,
          )}
          {...props}
        >
          <div className="min-w-0 flex-1">{children}</div>
          <div className="flex shrink-0 items-center gap-4">
            {actions}
            {showClose ? (
              <ModalIconButton aria-label={closeLabel} asClose>
                <X aria-hidden="true" />
              </ModalIconButton>
            ) : null}
          </div>
        </div>
      </ModalHeaderContext.Provider>
    );
  }

  return (
    <ModalHeaderContext.Provider value="default">
      <div
        data-variant="default"
        className={cn(
          // `relative` anchors the close button, which the design pins
          // absolutely at 8/8 rather than placing it in the flow.
          "relative flex shrink-0 flex-col items-center gap-3 p-6",
          "rounded-t-xl bg-canvas",
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={cn(
              "absolute top-2 right-2 flex size-8 items-center justify-center",
              "rounded-xl bg-surface text-fg",
              "transition-colors duration-150 motion-reduce:transition-none",
              "hover:bg-surface-muted",
              "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
            )}
          >
            {/*
            The design draws a SOLID close-circle here, not an outline glyph,
            so it is composed rather than taken from Lucide (whose CircleX is
            stroked). Its fill is hardcoded `#1b1d1f` in the frame, which is
            invisible on the dark `#26282a` button, so it follows `fg` /
            `canvas` instead - the same call made for the Tag and Chip icons.
          */}
            <span className="flex size-4 items-center justify-center rounded-full bg-fg">
              <X aria-hidden="true" className="size-2.5 text-canvas" strokeWidth={3.5} />
            </span>
          </DialogPrimitive.Close>
        ) : null}
      </div>
    </ModalHeaderContext.Provider>
  );
}

/** 24x24 icon button used by the mailbox header. */
export function ModalIconButton({
  asClose = false,
  className,
  ...props
}: ComponentProps<"button"> & { asClose?: boolean }) {
  const button = (
    <button
      type="button"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-xl p-1",
        "text-fg-muted",
        "transition-colors duration-150 motion-reduce:transition-none",
        "hover:bg-surface hover:text-fg",
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        "[&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );

  return asClose ? <DialogPrimitive.Close asChild>{button}</DialogPrimitive.Close> : button;
}

export type ModalTitleProps = ComponentProps<typeof DialogPrimitive.Title>;

export function ModalTitle({ className, ...props }: ModalTitleProps) {
  // 20px Medium in the default bar, 14px Medium in the mailbox bar.
  const variant = useContext(ModalHeaderContext);
  return (
    <DialogPrimitive.Title
      className={cn(
        "w-full truncate text-fg",
        variant === "mailbox" ? "text-subhead-medium" : "text-h5",
        className,
      )}
      {...props}
    />
  );
}

export type ModalDescriptionProps = ComponentProps<typeof DialogPrimitive.Description>;

export function ModalDescription({ className, ...props }: ModalDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={cn("w-full text-subhead-regular text-fg-muted", className)}
      {...props}
    />
  );
}

/**
 * The scrolling middle. Horizontal padding matches the bars; vertical spacing
 * comes from the bars' own 24px padding, so the body only adds its own bottom
 * padding when nothing follows it.
 */
export function ModalBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6",
        "last:pb-6",
        className,
      )}
      {...props}
    />
  );
}

export interface ModalFooterProps extends ComponentProps<"div"> {
  /**
   * Left-aligned slot: the design uses it for a destructive action or a
   * "don't show again" checkbox. Both are shipped disabled in the frame, so
   * this is optional.
   */
  left?: ReactNode;
}

export function ModalFooter({ left, className, children, ...props }: ModalFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-6 p-6",
        "rounded-b-xl bg-canvas",
        // Stack on narrow screens so two 40px buttons never squash.
        "max-sm:flex-col-reverse max-sm:items-stretch max-sm:gap-3",
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 items-center gap-4 max-sm:justify-center">{left}</div>
      <div className="flex shrink-0 items-center gap-2 max-sm:flex-col max-sm:[&>*]:w-full">
        {children}
      </div>
    </div>
  );
}

export interface ModalStepsProps extends ComponentProps<"ol"> {
  steps: string[];
  /** Zero-based index of the active step. */
  current?: number;
}

/**
 * The optional step rail from the default header. Present but disabled in the
 * Pencil frame, so it is opt-in here too.
 *
 * Renders an ordered list with `aria-current="step"` rather than a row of
 * divs, so the sequence and the current position are conveyed without sight.
 */
export function ModalSteps({ steps, current = 0, className, ...props }: ModalStepsProps) {
  return (
    <ol className={cn("flex w-full items-center gap-2", className)} {...props}>
      {steps.map((label, i) => {
        const active = i <= current;
        const last = i === steps.length - 1;
        return (
          <li
            // Keyed by position, not label: steps are a fixed ordered
            // sequence that is never reordered, and labels repeat (the design
            // itself names all three "Step Name"), so a label key collides.
            key={i}
            aria-current={i === current ? "step" : undefined}
            className={cn("flex items-center gap-2", !last && "flex-1")}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface",
                "text-caption-1-semibold",
                "transition-colors duration-300 ease-out motion-reduce:transition-none",
                active ? "text-fg" : "text-fg-subtle",
              )}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              className={cn(
                "shrink-0 text-caption-2-semibold",
                "transition-colors duration-300 ease-out motion-reduce:transition-none",
                active ? "text-fg" : "text-fg-subtle",
              )}
            >
              {label}
            </span>
            {!last ? (
              // Track plus a fill bar that wipes left-to-right, rather than a
              // single element swapping colour. `scaleX` is composited, so
              // the wipe costs no layout, and `origin-left` is what makes it
              // read as progress advancing rather than a bar appearing.
              <span
                aria-hidden="true"
                className="h-px min-w-10 flex-1 overflow-hidden bg-border-strong"
              >
                <span
                  className={cn(
                    "block h-full w-full origin-left bg-fg",
                    "transition-transform duration-500 ease-out motion-reduce:transition-none",
                    i < current ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
