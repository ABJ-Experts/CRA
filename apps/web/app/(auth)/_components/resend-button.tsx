"use client";

import { cn } from "@repo/ui/cn";
import { useEffect, useRef, useState } from "react";

/**
 * "Resend code" with a cooldown.
 *
 * Without one, a frustrated user taps resend repeatedly, invalidating each
 * previous code and guaranteeing the one they eventually receive is stale.
 * The countdown is announced politely so it is not just a visual state.
 */
export function ResendButton({
  seconds = 30,
  onResend,
  className,
}: {
  seconds?: number;
  onResend: () => Promise<unknown> | void;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (remaining <= 0) return;
    timer.current = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = remaining <= 0 && !sending;

  return (
    <div className={cn("flex items-center justify-center gap-1", className)}>
      <span className="text-subhead-regular text-fg-muted">
        Did not get the code?
      </span>
      <button
        type="button"
        disabled={!ready}
        onClick={async () => {
          setSending(true);
          try {
            await onResend();
            setRemaining(seconds);
          } finally {
            setSending(false);
          }
        }}
        className={cn(
          "rounded-xl px-0.5 py-px text-subhead-semibold",
          "transition-colors duration-150 motion-reduce:transition-none",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          ready
            ? "text-active-500 hover:text-active-600"
            : "cursor-not-allowed text-fg-subtle"
        )}
        data-testid="resend"
      >
        {sending ? "Sending..." : ready ? "Resend" : `Resend in ${remaining}s`}
      </button>
      <span aria-live="polite" className="sr-only">
        {ready ? "You can request a new code now" : ""}
      </span>
    </div>
  );
}
