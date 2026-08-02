"use client";

import { cn } from "@repo/ui/cn";
import { Quote } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The quote card overlaid on the art panel.
 *
 * Measured from `a1za5` -> `KoTL0` (identical in the dark frames, since every
 * value is theme-independent):
 *
 *   card    539x184, radius 24, padding 24, gap 16, centred
 *           fill #ffffff26 -> `scrim-white-15`, 1px white border
 *   glyph   24px quote mark
 *   body    16px Regular, #1b1d1f / #ffffff -> `fg`
 *   slide   16x8 pill + two 8px dots, gap 6
 *
 * The body ink DOES flip with the theme (checked against `hX9FF`), which is
 * plain `fg`. The slide indicator does not: the active pill is white and the
 * inactive dots are ink in both frames, so those stay fixed palette steps.
 */

export interface AuthQuoteProps {
  quotes?: string[];
  /** Milliseconds between slides. 0 disables rotation. */
  interval?: number;
  className?: string;
}

const DEFAULT_QUOTES = [
  "CRA is Premium UI kits. Super a lot of layouts designed with the atomic system, to help us improve quickly our products",
  "Every component is transcribed from the design file and verified in the browser, so what ships is what was drawn",
  "One token layer drives both themes, which is why every screen re-themes from a single attribute",
];

export function AuthQuote({
  quotes = DEFAULT_QUOTES,
  interval = 7000,
  className,
}: AuthQuoteProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (interval <= 0 || quotes.length < 2 || paused) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % quotes.length),
      interval
    );
    return () => clearInterval(id);
  }, [interval, quotes.length, paused]);

  // Respect a reduced-motion preference: auto-rotating text is motion.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPaused(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <figure
      className={cn(
        "flex max-w-[539px] flex-col justify-center gap-4",
        "rounded-3xl border border-white bg-scrim-white-15 p-6",
        "backdrop-blur-sm",
        className
      )}
    >
      <Quote aria-hidden="true" className="size-6 shrink-0 text-fg" />
      {/*
        `aria-live="off"` on purpose: this is decoration beside a login form,
        and announcing a new marketing line every few seconds would interrupt
        someone filling in the field.
      */}
      <blockquote aria-live="off" className="text-body text-fg">
        {quotes[index]}
      </blockquote>

      {quotes.length > 1 ? (
        <div className="flex items-center gap-1.5">
          {quotes.map((q, i) => (
            <button
              key={q}
              type="button"
              aria-label={`Show quote ${i + 1} of ${quotes.length}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
              className={cn(
                "h-2 rounded-full transition-[width,background-color] duration-200",
                "motion-reduce:transition-none",
                "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
                i === index ? "w-4 bg-white" : "w-2 bg-neutral-light-500"
              )}
            />
          ))}
        </div>
      ) : null}
    </figure>
  );
}
