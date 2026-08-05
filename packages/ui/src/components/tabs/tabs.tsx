"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import {
  tabsCountVariants,
  tabsListVariants,
  tabsTriggerVariants,
  type TabsVariantProps,
} from "./tabs.variants";

/**
 * Tabs — Pencil frame `o1gsz`.
 *
 * Built on Radix Tabs so the behaviour is not reimplemented: roving tabindex,
 * arrow-key navigation with Home/End, `role="tablist"`/`"tab"`/`"tabpanel"`,
 * `aria-selected` and the trigger <-> panel `aria-controls` wiring all come
 * from the primitive. Only the styling is ours.
 *
 * ```tsx
 * <Tabs defaultValue="all" variant="outline">
 *   <TabsList>
 *     <TabsTrigger value="all" icon={<Menu />} count={128}>All</TabsTrigger>
 *     <TabsTrigger value="mine" icon={<User />}>Mine</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="all">...</TabsContent>
 *   <TabsContent value="mine">...</TabsContent>
 * </Tabs>
 * ```
 */

type TabsStyle = NonNullable<TabsVariantProps["variant"]>;
type TabsSize = NonNullable<TabsVariantProps["size"]>;

interface TabsStyleContext {
  variant: TabsStyle;
  size: TabsSize;
}

/**
 * Carries the visual axes from `Tabs` down to every trigger, so a consumer
 * sets `variant` once instead of repeating it on each child (and cannot get
 * them out of sync).
 */
const TabsStyleContext = createContext<TabsStyleContext>({
  variant: "line",
  size: "sm",
});

export interface TabsProps extends ComponentProps<typeof TabsPrimitive.Root> {
  /** `line` (underline), `fill` (segmented) or `outline` (pill). */
  variant?: TabsStyle;
  /**
   * The design defines a Medium size for `variant="line"` only. `fill` and
   * `outline` have a single size and ignore this.
   */
  size?: TabsSize;
}

export function Tabs({ variant = "line", size = "sm", className, ...props }: TabsProps) {
  return (
    <TabsStyleContext.Provider value={{ variant, size }}>
      <TabsPrimitive.Root className={cn("flex flex-col gap-4", className)} {...props} />
    </TabsStyleContext.Provider>
  );
}

export type TabsListProps = ComponentProps<typeof TabsPrimitive.List>;

export function TabsList({ className, children, ...props }: TabsListProps) {
  const { variant } = useContext(TabsStyleContext);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  // Suppresses the slide on the very first paint, so the bar appears under the
  // initial tab instead of flying in from x=0.
  const [ready, setReady] = useState(false);

  /**
   * Tracks the active trigger's box so the underline can slide to it.
   *
   * Driven by a MutationObserver on `data-state` rather than by the Tabs
   * value: the value can be controlled, uncontrolled or changed by keyboard
   * roving, and the attribute is the one thing all three funnel through.
   */
  useLayoutEffect(() => {
    if (variant !== "line") return;
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active) {
        setIndicator(null);
        return;
      }
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();
    // Let the first measurement land before transitions turn on, otherwise
    // the bar slides in from x=0 on mount. rAF is the accurate signal, but it
    // does not fire in a background tab, so a timer backs it up - without the
    // fallback the indicator would never become animated there.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    const timer = setTimeout(() => setReady(true), 60);

    const mo = new MutationObserver(measure);
    mo.observe(list, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    // Fonts loading or the container resizing both move the triggers.
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    for (const tab of list.querySelectorAll('[role="tab"]')) ro.observe(tab);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      mo.disconnect();
      ro.disconnect();
    };
  }, [variant]);

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn(
        tabsListVariants({ variant }),
        // `relative` makes the list the offsetParent, so the indicator's
        // `offsetLeft` maths below is in the same coordinate space.
        "relative",
        // Long tab bars scroll instead of wrapping. `overflow-x: auto` here is
        // safe: it is on the list, not on <html>, so it does not break the
        // overflow propagation that overlay scroll-locking depends on.
        "overflow-x-auto",
        // Segmented tabs need the outer corners rounded and the hairline
        // clipped; the triggers themselves are square so they butt together.
        variant === "fill" && "w-fit overflow-hidden rounded-lg border-l border-border",
        className,
      )}
      {...props}
    >
      {children}
      {variant === "line" && indicator ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute bottom-0 left-0 h-0.5 bg-fg",
            ready && "transition-[translate,width] duration-250 ease-out",
            "motion-reduce:transition-none",
          )}
          style={{
            width: `${indicator.width}px`,
            // `translate` rather than `left` so the slide is composited and
            // does not trigger layout on every frame.
            translate: `${indicator.left}px 0`,
          }}
        />
      ) : null}
    </TabsPrimitive.List>
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  icon?: ReactNode;
  /**
   * Count pill. Numbers over `countMax` render as `${countMax}+`, matching the
   * design's `99+`. Pass a string to render it verbatim.
   */
  count?: number | string;
  countMax?: number;
}

export function TabsTrigger({
  icon,
  count,
  countMax = 99,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const { variant, size } = useContext(TabsStyleContext);

  const countLabel = typeof count === "number" && count > countMax ? `${countMax}+` : count;

  const label = <span className="min-w-0 truncate">{children}</span>;

  const pill =
    countLabel === undefined || countLabel === "" ? null : (
      <span className={tabsCountVariants({ variant })}>{countLabel}</span>
    );

  return (
    <TabsPrimitive.Trigger
      className={cn(tabsTriggerVariants({ variant, size }), className)}
      {...props}
    >
      {icon}
      {/*
        `line` and `fill` group the label and the count into one 4px-gap unit
        that sits 8px from the icon. `outline` spaces all three evenly at 12px,
        so it must NOT introduce the extra wrapper.
      */}
      {variant === "outline" ? (
        <>
          {label}
          {pill}
        </>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          {label}
          {pill}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
}

export type TabsContentProps = ComponentProps<typeof TabsPrimitive.Content>;

export function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        // The panel fades and lifts in as it becomes active, so switching
        // reads as a transition rather than a hard swap. Only the entrance is
        // animated: Radix unmounts the outgoing panel immediately, so an exit
        // animation would never be seen.
        "data-[state=active]:animate-panel-in",
        "motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
