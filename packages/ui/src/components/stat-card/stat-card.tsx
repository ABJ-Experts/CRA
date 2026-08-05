"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * StatCard - the metric tile from the dashboard frames.
 *
 * Pencil `XMl3A` (Dasboard / E-commerce / Total): 209x104, padding 24,
 * value 30px at y24, caption 18px at y62.
 *
 * The value counts up on first view. That is the one animation the frames
 * imply and it earns its place: a dashboard of five numbers appearing at once
 * is hard to read, and the roll-up staggers attention across them. It runs
 * ONCE, only when scrolled into view, and is skipped entirely under
 * `prefers-reduced-motion`, where the final value is rendered immediately.
 */

export interface StatCardProps {
  label: string;
  /** Numeric target for the roll-up. Omit to render `display` verbatim. */
  value?: number;
  /** Formats the animated value, e.g. `(n) => \`$\${n.toFixed(0)}K\``. */
  format?: (value: number) => string;
  /** Static content, used when `value` is absent. */
  display?: ReactNode;
  delta?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

function useCountUp(target: number, active: boolean, durationMs = 900) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? target : 0);

  useEffect(() => {
    if (reduced) {
      setN(target);
      return;
    }
    if (!active) return;

    let raf = 0;
    let start: number | null = null;
    const step = (t: number) => {
      start ??= t;
      const p = Math.min(1, (t - start) / durationMs);
      /* easeOutCubic: fast then settling, which reads as the number landing
       * rather than crawling to a stop. */
      setN(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active, durationMs, reduced]);

  return n;
}

export function StatCard({ label, value, format, display, delta, icon, className }: StatCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const n = useCountUp(value ?? 0, inView && value != null);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn(
        "flex min-w-0 flex-col justify-center gap-2 rounded-2xl p-6",
        "border border-border bg-canvas",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-h4 text-fg tabular-nums">
          {value != null ? (format ? format(n) : Math.round(n).toLocaleString()) : display}
        </span>
        {icon ? <span className="shrink-0 text-fg-subtle">{icon}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="truncate text-caption-1-regular text-fg-muted">{label}</span>
        {delta}
      </div>
    </motion.div>
  );
}

/** Signed change pill used beside a stat value. */
export function DeltaBadge({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-caption-2-semibold tabular-nums",
        up ? "bg-success-surface text-success-fg" : "bg-danger-surface text-danger-fg",
      )}
    >
      {up ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}
