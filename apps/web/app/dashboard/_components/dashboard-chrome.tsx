"use client";

import { cn } from "@repo/ui/cn";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Shared dashboard chrome: the page header from the frames' TopNavigation
 * `Name` block, the section card, and the mount stagger.
 *
 * The stagger is deliberately small (60ms between cards, 8px of travel). A
 * dashboard is read at a glance, so anything longer turns loading into
 * waiting. It is disabled wholesale under `prefers-reduced-motion`.
 */

export function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-h5 text-fg">{title}</h1>
        {subtitle ? (
          <p className="truncate text-caption-1-regular text-fg-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-border bg-canvas",
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 px-6 pt-6 pb-2">
          <h2 className="truncate text-subhead-semibold text-fg">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn("min-w-0 flex-1 p-6", title && "pt-2", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Wraps a dashboard's top-level children so they fade in one after another. */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: reduced ? 0 : 0.06 } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduced ? { opacity: 1 } : { opacity: 0, y: 8 },
        shown: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.32, ease: "easeOut" },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
