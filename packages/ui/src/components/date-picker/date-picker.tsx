"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { format, isValid, parse } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { inputFieldVariants } from "../input/input.variants";
import { Calendar } from "./calendar";

/**
 * DatePicker - Pencil frame `hW0yQ` ("Forms/Date Picker").
 *
 * The trigger is the Input's field verbatim (h40, radius 12, padding
 * 10 12 9 12, gap 12, 1px `border`, focus `active-500`) with the placeholder
 * "DD MM YYYY" and a trailing calendar glyph. `State=Selecting` is that field
 * focused with the panel open below it.
 *
 * ```tsx
 * <DatePicker label="Date" required value={date} onValueChange={setDate} />
 * ```
 */

export interface DatePickerProps {
  /** Controlled value. Pair with `onValueChange`. */
  value?: Date;
  /** Uncontrolled initial value. */
  defaultValue?: Date;
  onValueChange?: (date: Date | undefined) => void;

  label?: ReactNode;
  required?: boolean;
  helperText?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  /** 40px (`md`), 48px (`lg`) or 56px (`xl`), matching Input. */
  size?: "md" | "lg" | "xl";

  /**
   * date-fns pattern for both display and typed input. The frame shows
   * "DD MM YYYY"; the default here is the equivalent `dd MM yyyy`.
   */
  formatStr?: string;
  placeholder?: string;

  /** Bounds passed through to the calendar. */
  fromDate?: Date;
  toDate?: Date;
  disabledDates?: Date[];

  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

export function DatePicker({
  value: controlledValue,
  defaultValue,
  onValueChange,
  label,
  required = false,
  helperText,
  error,
  disabled = false,
  size = "md",
  formatStr = "dd MM yyyy",
  placeholder = "DD MM YYYY",
  fromDate,
  toDate,
  disabledDates,
  className,
  wrapperClassName,
  ...rest
}: DatePickerProps) {
  const autoId = useId();
  const inputId = `date-${autoId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const [open, setOpen] = useState(false);
  const [uncontrolled, setUncontrolled] = useState<Date | undefined>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const selected = isControlled ? controlledValue : uncontrolled;

  /**
   * The typed text is separate state from the selected Date. Deriving it from
   * `selected` alone would fight the user: every keystroke that does not yet
   * parse would be thrown away as they typed it.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const triggerRef = useRef<HTMLInputElement>(null);

  const display = useMemo(
    () => (draft !== null ? draft : selected ? format(selected, formatStr) : ""),
    [draft, selected, formatStr],
  );

  const hasError = Boolean(error);
  const state = disabled ? "disabled" : hasError ? "error" : "default";

  const commit = (next: Date | undefined) => {
    if (!isControlled) setUncontrolled(next);
    onValueChange?.(next);
  };

  const commitDraft = (text: string) => {
    if (text.trim() === "") {
      setDraft(null);
      commit(undefined);
      return;
    }
    const parsed = parse(text, formatStr, new Date());
    if (isValid(parsed)) {
      setDraft(null);
      commit(parsed);
    } else {
      // Keep the unparseable text visible rather than silently reverting, so
      // the user can see and fix what they typed.
      setDraft(text);
    }
  };

  const describedBy =
    [hasError ? errorId : null, helperText && !hasError ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex w-full flex-col gap-1", wrapperClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
          className={cn(
            "flex items-center gap-0.5 text-caption-1-semibold",
            disabled ? "text-fg-subtle" : "text-fg-muted",
          )}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className={disabled ? "text-fg-subtle" : "text-danger"}>
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <div className={cn(inputFieldVariants({ size, state }), className)} {...rest}>
          <input
            ref={triggerRef}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={placeholder}
            disabled={disabled}
            value={display}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-errormessage={hasError ? errorId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commitDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft(e.currentTarget.value);
              }
            }}
            className={cn(
              "min-w-0 flex-1 bg-transparent",
              "text-fg placeholder:text-border-strong",
              "border-0 p-0 outline-none",
              "disabled:cursor-not-allowed disabled:text-fg-subtle disabled:placeholder:text-fg-subtle",
              size === "xl" ? "text-h5" : "text-subhead-regular",
            )}
          />

          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              // The field itself stays a text input so a date can be typed;
              // only this glyph opens the calendar. Labelled, because an icon
              // alone tells a screen reader nothing about what it does.
              aria-label="Choose date"
              disabled={disabled}
              className={cn(
                "flex shrink-0 items-center justify-center rounded",
                "text-fg transition-colors duration-150 motion-reduce:transition-none",
                "hover:text-active-500",
                "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
                "disabled:cursor-not-allowed disabled:hover:text-fg",
              )}
            >
              <CalendarDays aria-hidden="true" className="size-4" strokeWidth={1.5} />
            </button>
          </PopoverPrimitive.Trigger>
        </div>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className={cn(
              "z-50 w-100 rounded-xl bg-elevated",
              // The frame's two stacked shadows.
              "shadow-[0_8px_14px_rgb(0_0_0/0.1),0_2px_7px_rgb(0_0_0/0.1)]",
              "outline-none",
              "data-[state=open]:animate-overlay-in",
              // No exit animation: Radix keeps the layer mounted until
              // `animationend`, and a Popover does not reliably fire it.
              "data-[state=closed]:animate-none",
              "motion-reduce:animate-none",
            )}
            // Radix returns focus to its trigger - here the calendar glyph.
            // Redirect to the text field instead: after picking a date the
            // likely next action is correcting it, and a `.focus()` inside
            // `onSelect` is silently overridden by this handler.
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                setDraft(null);
                commit(date);
                setOpen(false);
              }}
              startMonth={fromDate}
              endMonth={toDate}
              disabled={disabledDates}
            />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

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
