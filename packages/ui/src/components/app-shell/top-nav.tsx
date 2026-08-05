"use client";

import { Bell, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Avatar } from "../avatar";

/**
 * TopNav - the 64px bar every dashboard and table frame sits under.
 *
 * Measured from `UDxZr` (Dashboard / E-commerce) and `GujAB` (Tables / Basic),
 * which are the same component with different left-hand content:
 *
 *   bar        64 tall, 1px bottom hairline in `border`, 30px side padding
 *   left       either a Name block (20/600 over 12/400) or Breadcrumbs
 *   centre     optional 300x40 control, the frames use a date picker
 *   right      Action group 144x32: Search 32, Notification 32, Avatar 32,
 *              gap 24
 *
 * Left content is a slot rather than a `title`/`subtitle` pair because the
 * two frames genuinely differ: dashboards greet the user, tables show a
 * breadcrumb trail. `TopNavTitle` covers the first case.
 */

export interface TopNavProps {
  /** Left-hand content: a `TopNavTitle`, breadcrumbs, or anything else. */
  children?: ReactNode;
  /** Optional centre control, e.g. a date range picker. */
  centre?: ReactNode;
  /** Replaces the default Search / Notification / Avatar group. */
  actions?: ReactNode;
  /** Shown on the default avatar. */
  user?: { name: string; initials?: string; src?: string };
  notificationCount?: number;
  onSearchClick?: () => void;
  onNotificationsClick?: () => void;
  /** Rendered before the left content, e.g. a mobile menu button. */
  leading?: ReactNode;
  className?: string;
}

export function TopNavTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <span className="truncate text-subhead-semibold text-fg">{title}</span>
      {subtitle ? (
        <span className="truncate text-caption-2-regular text-fg-muted">{subtitle}</span>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  badge,
  children,
}: {
  label: string;
  onClick?: () => void;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label}, ${badge} unread` : label}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-lg",
        "text-fg-muted transition-colors hover:bg-surface hover:text-fg",
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
      )}
    >
      {children}
      {badge ? (
        /* A dot, not a count: the frame's 32px control has no room for digits
         * and the exact number is already in the sidebar's notice badge. */
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 size-2 rounded-full bg-brink-red-500 ring-2 ring-canvas"
        />
      ) : null}
    </button>
  );
}

export function TopNav({
  children,
  centre,
  actions,
  user,
  notificationCount,
  onSearchClick,
  onNotificationsClick,
  leading,
  className,
}: TopNavProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4",
        "border-b border-border bg-canvas px-6 lg:px-[30px]",
        className,
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-center">{children}</div>

      {centre ? <div className="hidden shrink-0 lg:block">{centre}</div> : null}

      <div className="flex shrink-0 items-center gap-6">
        {actions ?? (
          <>
            <IconButton label="Search" onClick={onSearchClick}>
              <Search aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton
              label="Notifications"
              onClick={onNotificationsClick}
              badge={notificationCount}
            >
              <Bell aria-hidden="true" className="size-4" />
            </IconButton>
            {user ? (
              /* `status` is Avatar's own presence dot, which already sits in
               * the frame's bottom-right corner and shares that slot with the
               * verified badge. Drawing a second one here would collide. */
              <Avatar
                size="sm"
                src={user.src}
                name={user.name}
                initials={user.initials}
                status="online"
                className="shrink-0"
              />
            ) : null}
          </>
        )}
      </div>
    </header>
  );
}
