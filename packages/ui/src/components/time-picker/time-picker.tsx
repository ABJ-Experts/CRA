"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Clock } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { inputFieldVariants } from "../input/input.variants";
import { Select, SelectItem } from "../select";

/**
 * TimePicker - Pencil frame `CaAId` ("Forms/Time Picker").
 *
 * Trigger is Input's field with the placeholder "00 : 00" and a trailing
 * clock. `State=Selecting` opens a 400x94 panel (radius 12, padding 16,
 * gap 4, `alignItems: end`, `elevated`, the same two shadows as the Date
 * Picker) holding three Selects with a ":" between the first two.
 *
 * The third column - AM/PM - ships with its Label disabled in the frame,
 * which is why the panel bottom-aligns: the meridiem field lines up with the
 * other two even though it has no caption above it.
 *
 * The value is a 24-hour "HH:mm" string, not a Date. A time of day has no
 * date, and carrying one invites timezone bugs at the boundaries; "HH:mm"
 * also drops straight into a Zod `z.string().regex(...)`.
 *
 * ```tsx
 * <TimePicker label="Label" required value={time} onValueChange={setTime} />
 * ```
 */

export interface TimePickerProps {
  /** Controlled 24-hour "HH:mm". Pair with `onValueChange`. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;

  label?: ReactNode;
  required?: boolean;
  helperText?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  size?: "md" | "lg" | "xl";

  /** 12 shows the AM/PM column, as the frame does. 24 hides it. */
  hourCycle?: 12 | 24;
  /** Step between selectable minutes. */
  minuteStep?: number;

  placeholder?: string;
  labels?: Partial<{ hour: string; minute: string; meridiem: string }>;

  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:mm" -> parts, or nulls when unset or malformed. */
function parse(value: string | undefined) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!m) return { hour: null, minute: null };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return { hour: null, minute: null };
  return { hour, minute };
}

export function TimePicker({
  value: controlledValue,
  defaultValue,
  onValueChange,
  label,
  required = false,
  helperText,
  error,
  disabled = false,
  size = "md",
  hourCycle = 12,
  minuteStep = 1,
  placeholder = "00 : 00",
  labels,
  className,
  wrapperClassName,
  ...rest
}: TimePickerProps) {
  const t = { hour: "Hour", minute: "Minute", meridiem: "AM/PM", ...labels };

  const autoId = useId();
  const triggerId = `time-${autoId}`;
  const errorId = `${triggerId}-error`;
  const helperId = `${triggerId}-helper`;

  const [open, setOpen] = useState(false);
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolled;

  const { hour, minute } = parse(value);
  const hasError = Boolean(error);
  const state = disabled ? "disabled" : hasError ? "error" : "default";

  const commit = (h: number | null, m: number | null) => {
    // Both halves are needed before a time exists; until then keep the
    // partial choice in the panel without emitting an invalid value.
    if (h === null || m === null) {
      const next = h !== null ? `${pad(h)}:${pad(m ?? 0)}` : "";
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);
      return;
    }
    const next = `${pad(h)}:${pad(m)}`;
    if (!isControlled) setUncontrolled(next);
    onValueChange?.(next);
  };

  // Display follows the frame: "00 : 00", with the meridiem appended in 12h.
  const display =
    hour === null || minute === null
      ? ""
      : hourCycle === 12
        ? `${pad(((hour + 11) % 12) + 1)} : ${pad(minute)} ${hour < 12 ? "AM" : "PM"}`
        : `${pad(hour)} : ${pad(minute)}`;

  const hours =
    hourCycle === 12
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);

  const displayHour =
    hour === null ? "" : hourCycle === 12 ? String(((hour + 11) % 12) + 1) : String(hour);
  const meridiem = hour === null ? "" : hour < 12 ? "AM" : "PM";

  /** Rebuild a 24-hour value from whichever part just changed. */
  const setHour = (raw: string) => {
    const h12 = Number(raw);
    if (hourCycle === 24) return commit(h12, minute ?? 0);
    const isPm = (meridiem || "AM") === "PM";
    commit((h12 % 12) + (isPm ? 12 : 0), minute ?? 0);
  };
  const setMeridiem = (raw: string) => {
    if (hour === null) return;
    const base = hour % 12;
    commit(raw === "PM" ? base + 12 : base, minute ?? 0);
  };

  const describedBy =
    [hasError ? errorId : null, helperText && !hasError ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex w-full flex-col gap-1", wrapperClassName)}>
      {label ? (
        <label
          htmlFor={triggerId}
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
        <PopoverPrimitive.Trigger asChild>
          <button
            id={triggerId}
            type="button"
            disabled={disabled}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-errormessage={hasError ? errorId : undefined}
            className={cn(
              inputFieldVariants({ size, state }),
              "justify-between text-left",
              "outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-active-500",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
              className,
            )}
            {...rest}
          >
            <span
              className={cn("min-w-0 flex-1 truncate", display ? "text-fg" : "text-border-strong")}
            >
              {display || placeholder}
            </span>
            <Clock aria-hidden="true" className="shrink-0 text-fg" strokeWidth={1.5} />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className={cn(
              "z-50 w-[var(--radix-popover-trigger-width)] min-w-100",
              "flex items-end gap-1 rounded-xl bg-elevated p-4",
              "shadow-[0_8px_14px_rgb(0_0_0/0.1),0_2px_7px_rgb(0_0_0/0.1)]",
              "outline-none",
              "data-[state=open]:animate-overlay-in",
              // Radix keeps a Popover layer mounted until `animationend`,
              // which does not reliably fire; unmount synchronously instead.
              "data-[state=closed]:animate-none",
              "motion-reduce:animate-none",
            )}
          >
            <Select
              label={t.hour}
              required
              value={displayHour}
              onValueChange={setHour}
              placeholder="--"
              wrapperClassName="flex-1"
              data-testid="time-hour"
            >
              {hours.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {pad(h)}
                </SelectItem>
              ))}
            </Select>

            {/* The frame's ":" column: 12 wide, pushed down so it sits on the
                fields' centre line rather than beside the labels. */}
            <span
              aria-hidden="true"
              className="flex h-10 w-3 shrink-0 items-center justify-center text-subhead-regular text-border-strong"
            >
              :
            </span>

            <Select
              label={t.minute}
              required
              value={minute === null ? "" : String(minute)}
              onValueChange={(v) => commit(hour ?? 0, Number(v))}
              placeholder="--"
              wrapperClassName="flex-1"
              data-testid="time-minute"
            >
              {minutes.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {pad(m)}
                </SelectItem>
              ))}
            </Select>

            {hourCycle === 12 ? (
              <Select
                aria-label={t.meridiem}
                value={meridiem}
                onValueChange={setMeridiem}
                placeholder="--"
                wrapperClassName="flex-1"
                data-testid="time-meridiem"
              >
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </Select>
            ) : null}
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
