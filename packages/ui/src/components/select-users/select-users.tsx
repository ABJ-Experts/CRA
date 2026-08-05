"use client";

import { useId, type ReactNode } from "react";
import { Avatar, type AvatarStatus } from "../avatar";
import { cn } from "../../lib/cn";
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from "../select";

/**
 * SelectUsers - Pencil frame `js7Em` ("Forms / Select Users").
 *
 * A person picker. Measured:
 *
 *   trigger  400x48, radius 12, padding 8 12 8 8, gap 8, 1px `border`
 *            32px avatar, name 14px Regular -> `fg`, 16px chevron
 *   panel    radius 12, padding 4, gap 2, `elevated`, bottom fade
 *   row      55 tall, radius 8, padding 12 8 11 8, gap 8
 *            32px avatar, name 14px Regular
 *   hovered  #f5f5f5 / #2e3133 -> `elevated-hover`
 *
 * The panel and rows are the Select's own `md` size unchanged: its padding is
 * already 12 8 11 8, and a 32px avatar inside that makes the row 55 tall, so
 * only the trigger needed restyling (48 tall rather than 40, to fit the
 * avatar).
 *
 * ```tsx
 * <SelectUsers label="Assignee" users={users} value={id} onValueChange={setId} />
 * ```
 */

export interface SelectUsersOption {
  value: string;
  name: string;
  src?: string;
  status?: AvatarStatus;
  /** Secondary line, e.g. a role or email. */
  description?: string;
  disabled?: boolean;
}

export interface SelectUsersProps {
  users: SelectUsersOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;

  label?: ReactNode;
  required?: boolean;
  helperText?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  placeholder?: string;

  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

export function SelectUsers({
  users,
  value,
  defaultValue,
  onValueChange,
  label,
  required = false,
  helperText,
  error,
  disabled = false,
  placeholder = "Select a person",
  className,
  wrapperClassName,
  ...rest
}: SelectUsersProps) {
  const autoId = useId();
  const triggerId = `users-${autoId}`;
  const errorId = `${triggerId}-error`;
  const helperId = `${triggerId}-helper`;

  const hasError = Boolean(error);
  const selected = users.find((u) => u.value === (value ?? defaultValue));

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

      <SelectRoot
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          id={triggerId}
          invalid={hasError}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-errormessage={hasError ? errorId : undefined}
          size="lg"
          className={cn(
            // `lg` is the shared 48px field. Only the avatar's 8px left inset
            // and the tighter gap are specific to this trigger.
            "gap-2 py-2 pr-3 pl-2",
            className,
          )}
          startIcon={
            selected ? (
              <Avatar
                name={selected.name}
                src={selected.src}
                status={selected.status}
                className="size-8 shrink-0"
              />
            ) : null
          }
          {...rest}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {users.map((u) => (
            <SelectItem
              key={u.value}
              value={u.value}
              disabled={u.disabled}
              // Without this Radix mirrors the row's whole text content into
              // the trigger, so a two-line row renders as
              // "Wade WarrenEngineering". It is also what type-ahead matches.
              textValue={u.name}
              description={u.description}
              startIcon={
                <Avatar name={u.name} src={u.src} status={u.status} className="size-8 shrink-0" />
              }
            >
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectRoot>

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
