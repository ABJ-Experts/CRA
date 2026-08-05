"use client";

import { Avatar } from "@repo/ui/avatar";
import { cn } from "@repo/ui/cn";
import { Bell, ChevronDown, PanelLeft, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NAV, type NavItem, type NavSection } from "./nav-config";
import { getStoredCollapsed, storeCollapsed } from "./sidebar-collapse";

/**
 * Sidebar - Pencil frame `ty4xx` ("Side Bars").
 *
 * Lives in `apps/web` rather than `packages/ui`: it is bound to this app's
 * routes and its `usePathname` active state, not a reusable primitive.
 *
 * Measured from the frame:
 *
 *   expanded    270 wide, 1px right border (#eeeeee / #2e3133 -> `border`)
 *   collapsed   66 wide
 *   logo row    64 tall, padding 16 20 16 24, space-between
 *   nav         padding 0 8
 *   item        56 tall, radius 12, padding 18 16 17 16, gap 8
 *               icon 20, label 14px Medium -> `subhead-medium` + `fg-muted`
 *               inner group gap 24, which is what puts the sub-item text at
 *               its 60px left inset (16 + 20 + 24)
 *   sub-item    48 tall, radius 12, padding 14 16 13 60
 *   section     43 tall, padding 14, 10px SemiBold -> `fg-subtle`
 *   notice      radius 9, padding 1 4 0 4, `brink-red-500`, 10px SemiBold
 *   bottom      padding 24, gap 24
 *
 * ONE ADDITION, deliberate: the frame ships no selected state - every item is
 * drawn in the resting colour and none carries a fill. A sidebar with no
 * current-page indicator is not shippable, so the active item is marked using
 * the same language Tabs already uses for selection: `surface-muted` behind
 * an `fg` label, with `surface` on hover. No new tokens.
 */

const EXPANDED = "w-[270px]";
const COLLAPSED = "w-[66px]";
/** Matches the attribute `sidebarScript` sets on <html> before first paint. */
const PRE_PAINT_COLLAPSED = "[html[data-sidebar=collapsed]_&]:w-[66px]";

function Notice({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-7 shrink-0 items-center justify-center",
        "rounded-[9px] px-1 pt-px",
        "bg-brink-red-500 text-caption-2-semibold text-white tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The 8px dot the frame shows instead of a count when the rail is collapsed. */
function NoticeDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-2 right-2 size-2 rounded-full bg-brink-red-500 ring-2 ring-canvas"
    />
  );
}

/**
 * `sections` is a prop so the product shell (/app) and the template's demo
 * shell (/dashboard) can share one sidebar with different navigation. It
 * defaults to the demo NAV, so existing callers are unchanged.
 */
export function Sidebar({ sections = NAV }: { sections?: NavSection[] } = {}) {
  const pathname = usePathname();
  /* Seeded false to match the server render, then corrected on mount from the
   * same value the pre-paint script already applied to <html>. Reading storage
   * during render instead would be a hydration mismatch. */
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsedState(getStoredCollapsed());
  }, []);

  const setCollapsed = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      storeCollapsed(value);
      return value;
    });
  }, []);

  const isActive = useCallback(
    (href?: string) => href !== undefined && (pathname === href || pathname.startsWith(`${href}/`)),
    [pathname],
  );

  /**
   * A parent counts as active when any of its children is. Derived rather
   * than stored, so navigating straight to a nested route still opens and
   * highlights the right group.
   */
  const activeParents = useMemo(() => {
    const open = new Set<string>();
    for (const section of sections) {
      for (const item of section.items) {
        if (item.children?.some((c) => isActive(c.href))) open.add(item.label);
      }
    }
    return open;
  }, [isActive, sections]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(activeParents);

  // Re-open the group containing the route whenever the route changes.
  useEffect(() => {
    setOpenGroups((prev) => new Set([...prev, ...activeParents]));
  }, [activeParents]);

  // Close the mobile drawer on navigation, or it covers the page you landed on.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const hasChildren = Boolean(item.children?.length);
    const open = openGroups.has(item.label);
    const selfActive = isActive(item.href);
    const groupActive = hasChildren && item.children!.some((c) => isActive(c.href));
    const active = selfActive || (groupActive && !open);

    const itemClasses = cn(
      "group relative flex h-14 w-full items-center gap-2 rounded-xl",
      "px-4 pt-[18px] pb-[17px]",
      /* `text-left` is load-bearing. Parent items render as <button> and leaf
       * items as <a>, and a button's UA default is `text-align: center`. The
       * label span is `flex-1`, so on a button the text centred itself in the
       * leftover space and drifted right, leaving every expandable item
       * visibly out of line with its siblings. */
      "text-left text-subhead-medium",
      "transition-colors duration-150 motion-reduce:transition-none",
      "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
      active ? "bg-surface-muted text-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
      collapsed && "justify-center px-0",
    );

    const inner = (
      <>
        {/* gap 24 between icon and label is what sets the sub-item inset. */}
        <span className={cn("flex min-w-0 flex-1 items-center gap-6", collapsed && "flex-none")}>
          <Icon aria-hidden="true" className="size-5 shrink-0" />
          {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
        </span>
        {!collapsed && item.notice !== undefined ? <Notice count={item.notice} /> : null}
        {collapsed && item.notice !== undefined ? <NoticeDot /> : null}
        {!collapsed && hasChildren ? (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        ) : null}
      </>
    );

    return (
      <li key={item.label}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => (collapsed ? setCollapsed(false) : toggleGroup(item.label))}
            aria-expanded={collapsed ? undefined : open}
            aria-controls={collapsed ? undefined : `nav-${item.label}`}
            title={collapsed ? item.label : undefined}
            className={itemClasses}
          >
            {inner}
          </button>
        ) : (
          <Link
            href={item.href ?? "#"}
            aria-current={selfActive ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={itemClasses}
          >
            {inner}
          </Link>
        )}

        {hasChildren && !collapsed ? (
          // Grid-rows 0fr -> 1fr animates to the content's natural height,
          // which `height: auto` cannot do. Kept unmounted-free so the
          // transition has something to animate from.
          <div
            id={`nav-${item.label}`}
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out",
              "motion-reduce:transition-none",
              open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <ul className="overflow-hidden">
              {item.children!.map((child) => (
                <li key={child.href}>
                  <Link
                    href={child.href}
                    aria-current={isActive(child.href) ? "page" : undefined}
                    className={cn(
                      "flex h-12 items-center gap-2 rounded-xl",
                      // 60px left inset aligns the label under its parent's.
                      "pt-[14px] pr-4 pb-[13px] pl-[60px]",
                      "text-subhead-medium",
                      "transition-colors duration-150 motion-reduce:transition-none",
                      "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
                      isActive(child.href)
                        ? "bg-surface-muted text-fg"
                        : "text-fg-muted hover:bg-surface hover:text-fg",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{child.label}</span>
                    {child.notice !== undefined ? <Notice count={child.notice} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </li>
    );
  };

  const rail = (
    <div className="flex h-full flex-col bg-canvas">
      {/* Logo row: 64 tall, padding 16 20 16 24. */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center justify-between gap-2.5",
          collapsed ? "px-4" : "py-4 pr-5 pl-6",
        )}
      >
        {!collapsed ? (
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-headline-semibold text-fg"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-active-500 text-white">
              C
            </span>
            CRA
          </Link>
        ) : (
          <span className="flex size-8 items-center justify-center rounded-lg bg-active-500 text-white">
            C
          </span>
        )}
        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className={cn(
              "hidden size-6 shrink-0 items-center justify-center rounded-xl p-1 lg:flex",
              "text-fg-muted transition-colors duration-150 motion-reduce:transition-none",
              "hover:bg-surface hover:text-fg",
              "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
            )}
          >
            <PanelLeft aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-xl p-1 lg:hidden",
            "text-fg-muted hover:bg-surface hover:text-fg",
            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          )}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {/* Nav: padding 0 8, with the frame's bottom fade over the scroll. */}
      <nav aria-label="Main" className="relative min-h-0 flex-1">
        <div
          className={cn(
            "h-full overflow-y-auto overscroll-contain pb-10",
            collapsed ? "px-1" : "px-2",
          )}
        >
          {sections.map((section, i) => (
            <div key={section.label ?? i}>
              {section.label && !collapsed ? (
                <p className="flex h-[43px] items-center px-3.5 text-caption-2-semibold text-fg-subtle">
                  {section.label}
                </p>
              ) : null}
              {section.label && collapsed ? <hr className="mx-2 my-2 border-border" /> : null}
              <ul className={cn("flex flex-col", collapsed && "gap-1")}>
                {section.items.map(renderItem)}
              </ul>
            </div>
          ))}
        </div>
        {/* The frame's "Hide Scroll" rectangle. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-grad-fade-canvas"
        />
      </nav>

      {/* Bottom: padding 24, gap 24. */}
      <div
        className={cn("flex shrink-0 flex-col gap-6", collapsed ? "items-center px-4 pb-6" : "p-6")}
      >
        <div className={cn("flex items-center gap-3", collapsed && "flex-col gap-4")}>
          <button
            type="button"
            aria-label="Notifications, 3 unread"
            className={cn(
              "relative flex size-8 shrink-0 items-center justify-center rounded-xl p-2",
              "text-fg-muted transition-colors duration-150 motion-reduce:transition-none",
              "hover:bg-surface hover:text-fg",
              "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
              !collapsed && "order-last",
            )}
          >
            <Bell aria-hidden="true" className="size-4" />
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 size-2 rounded-full bg-brink-red-500 ring-2 ring-canvas"
            />
          </button>
          <Avatar name="Ada Foster" status="online" className="size-10 shrink-0" />
          {!collapsed ? (
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-subhead-medium text-fg">Ada Foster</span>
              <span className="truncate text-caption-2-regular text-fg-subtle">ada@cra.com</span>
            </span>
          ) : null}
        </div>

        {!collapsed ? (
          <div className="flex flex-col gap-[3px]">
            <span className="text-caption-2-semibold text-fg">&copy; CRA Corp.</span>
            <span className="text-caption-2-regular text-fg-muted">All in One Premium UI Kits</span>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail. `border-r` is the frame's 1px Line at x=269. */}
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-border lg:block",
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? COLLAPSED : EXPANDED,
          /* Pre-hydration width. React's state starts expanded to match the
           * server, so on a load where the rail was collapsed it would paint
           * at 270 and snap to 66. The pre-paint script puts the attribute on
           * <html>, and this rule (higher specificity than the plain width
           * utility above) applies the narrow width from the first frame. It
           * stops matching as soon as the user expands, because
           * `storeCollapsed` removes the attribute. */
          PRE_PAINT_COLLAPSED,
        )}
      >
        {rail}
        {collapsed ? (
          // The frame's floating "Expand Menu" pill on the rail's edge.
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            className={cn(
              "absolute top-20 -right-3 flex size-6 items-center justify-center",
              "rounded-full border border-border bg-canvas p-1 text-fg-muted",
              "transition-colors duration-150 motion-reduce:transition-none",
              "hover:bg-surface hover:text-fg",
              "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
            )}
          >
            <PanelLeft aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </aside>

      {/* Mobile: a button in the page header opens this drawer. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
        className={cn(
          "fixed top-4 left-4 z-30 flex size-10 items-center justify-center lg:hidden",
          "rounded-xl border border-border bg-canvas text-fg-muted",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        )}
      >
        <PanelLeft aria-hidden="true" className="size-4" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-scrim-black-50"
          />
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-[270px] border-r border-border",
              "animate-overlay-in motion-reduce:animate-none",
            )}
          >
            {rail}
          </div>
        </div>
      ) : null}
    </>
  );
}
