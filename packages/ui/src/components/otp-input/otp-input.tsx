"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

/**
 * OtpInput - a one-time-code field.
 *
 * The Pencil file has no OTP frame, so the chrome is taken from the 48px
 * Admin Authorization field: radius 12, 1px `border`, `canvas` fill,
 * `accent-subtle` on hover, `active-500` on focus, `danger` on error. Boxes
 * flex to fill the 360px auth column.
 *
 * It renders ONE input per digit rather than a single masked field, because
 * that is what the pattern needs to support: per-box focus, backspace that
 * steps back, and arrow-key movement.
 *
 * ```tsx
 * <OtpInput length={6} onComplete={(code) => verify(code)} />
 * ```
 */

export interface OtpInputProps {
  /** Number of digits. */
  length?: number;
  /** Controlled value. Pair with `onChange`. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Fires once the last box is filled. Use it to auto-submit. */
  onComplete?: (value: string) => void;

  label?: ReactNode;
  /** Accessible name for the group when no visible label is given. */
  ariaLabel?: string;
  helperText?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  /** Focus the first box on mount. */
  autoFocus?: boolean;

  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

export function OtpInput({
  length = 6,
  value: controlledValue,
  defaultValue = "",
  onChange,
  onComplete,
  label,
  ariaLabel = "One-time code",
  helperText,
  error,
  disabled = false,
  autoFocus = false,
  className,
  wrapperClassName,
  ...rest
}: OtpInputProps) {
  const autoId = useId();
  const groupId = `otp-${autoId}`;
  const errorId = `${groupId}-error`;
  const helperId = `${groupId}-helper`;

  const [uncontrolled, setUncontrolled] = useState(defaultValue.slice(0, length));
  const isControlled = controlledValue !== undefined;
  const value = (isControlled ? controlledValue : uncontrolled).slice(0, length);

  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  // `onComplete` must fire once per completion, not on every render while the
  // code stays full (which would re-submit on a re-render).
  const completedFor = useRef<string | null>(null);

  const hasError = Boolean(error);

  const commit = useCallback(
    (next: string) => {
      const clipped = next.slice(0, length);
      if (!isControlled) setUncontrolled(clipped);
      onChange?.(clipped);
    },
    [isControlled, length, onChange]
  );

  useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < length) completedFor.current = null;
  }, [value, length, onComplete]);

  const focusBox = (i: number) => {
    const el = inputsRef.current[Math.min(Math.max(i, 0), length - 1)];
    el?.focus();
    el?.select();
  };

  /**
   * The code is kept LEFT-PACKED: a string of 0..length digits with no holes.
   *
   * Allowing a gap (clicking box 4 and typing while 1 to 3 are empty) cannot
   * be represented in a plain string, and every scheme that fakes it with
   * padding collapses the gap on the next edit, silently moving the digit
   * somewhere the user did not type it. So writes are clamped to the end of
   * the filled run, and `focusAt` mirrors that for clicks.
   */
  const write = (start: number, digits: string) => {
    const at = Math.min(start, value.length);
    const head = value.slice(0, at);
    const tail = value.slice(at + digits.length);
    const next = (head + digits + tail).slice(0, length);
    commit(next);
    focusBox(at + digits.length);
  };

  const handleChange = (i: number, raw: string) => {
    // Strip anything non-numeric so a stray character never lands in a box.
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    write(i, digits);
  };

  /** Clicking past the filled run lands on the first empty box, not a hole. */
  const focusAt = (i: number) => Math.min(i, value.length);

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      // Removing a digit closes the gap, keeping the run left-packed.
      const at = value[i] ? i : i - 1;
      if (at < 0) return;
      commit(value.slice(0, at) + value.slice(at + 1));
      focusBox(at);
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      if (!value[i]) return;
      commit(value.slice(0, i) + value.slice(i + 1));
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(focusAt(i - 1));
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(focusAt(i + 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusBox(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusBox(value.length);
    }
  };

  const handlePaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").trim();
    if (!text) return;
    // Pasting anywhere fills from that box onward, which is what people
    // expect when they paste a whole code into the middle of the group.
    e.preventDefault();
    const digits = text.replace(/\D/g, "");
    if (!digits) return;
    write(i, digits);
  };

  const describedBy =
    [hasError ? errorId : null, helperText && !hasError ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex w-full flex-col gap-1", wrapperClassName)} {...rest}>
      {label ? (
        <span
          id={`${groupId}-label`}
          className={cn(
            "text-caption-1-semibold",
            disabled ? "text-fg-subtle" : "text-fg-muted"
          )}
        >
          {label}
        </span>
      ) : null}

      {/*
        `role="group"` rather than a fieldset: the boxes are one logical field,
        and a screen reader should announce the group name once instead of
        reading six unlabelled text inputs.
      */}
      <div
        role="group"
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${groupId}-label` : undefined}
        aria-describedby={describedBy}
        className={cn("flex w-full items-center gap-3", className)}
      >
        {Array.from({ length }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            // Only the first box carries it: browsers fill the whole group
            // from the first field, and repeating it makes some of them
            // offer the code six times.
            autoComplete={i === 0 ? "one-time-code" : "off"}
            // `maxLength` alone is not enough - typing into a full box
            // replaces its content, which is the behaviour we want, and
            // `write` handles overflow into later boxes.
            maxLength={1}
            pattern="\d*"
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            value={value[i] ?? ""}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-invalid={hasError || undefined}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            // Only selects. An earlier version also dragged focus back to the
            // end of the filled run here, which fought the auto-advance: this
            // closure holds the value from the render BEFORE the digit landed,
            // so it saw the new box as out of range and bounced focus back,
            // swallowing every second keystroke. `write` already clamps the
            // write position, so the guard was redundant as well as wrong.
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-12 min-w-0 flex-1 rounded-xl bg-canvas text-center",
              "text-h5 text-fg",
              "transition-[box-shadow] duration-150 ease-out motion-reduce:transition-none",
              "outline-none",
              disabled
                ? "cursor-not-allowed bg-surface text-fg-subtle"
                : hasError
                  ? "inset-ring-1 inset-ring-danger hover:inset-ring-2 hover:inset-ring-danger focus:inset-ring-1"
                  : [
                      "inset-ring-1 inset-ring-border",
                      "hover:inset-ring-2 hover:inset-ring-accent-subtle",
                      "focus:inset-ring-1 focus:inset-ring-active-500",
                      "focus:hover:inset-ring-1 focus:hover:inset-ring-active-500",
                    ].join(" ")
            )}
          />
        ))}
      </div>

      {hasError ? (
        <p id={errorId} role="alert" className="text-caption-2-regular text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-caption-2-regular text-fg-subtle">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
