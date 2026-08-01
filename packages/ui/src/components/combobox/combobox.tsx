"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { inputFieldVariants } from "../input/input.variants";
import { selectContentVariants, selectItemVariants } from "../select/select.variants";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra text matched by the filter but not displayed as the label. */
  keywords?: string[];
  icon?: ReactNode;
  disabled?: boolean;
  /** Optional grouping heading. */
  group?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** Controlled value. Pair with `onValueChange`. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;

  label?: ReactNode;
  required?: boolean;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Placeholder inside the search box. */
  searchPlaceholder?: string;
  /** Shown when the filter matches nothing. */
  emptyMessage?: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  /** 40px (`md`), 48px (`lg`) or 56px (`xl`). */
  size?: "md" | "lg" | "xl";
  /** Show an inline clear button once a value is chosen. */
  clearable?: boolean;
  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

/**
 * Searchable select, built from the same design tokens as Select.
 *
 * Radix Select cannot filter its own options, so this composes a Radix Popover
 * (positioning, focus management, dismiss behaviour) with cmdk (filtering,
 * highlight, keyboard navigation). The trigger reuses `inputFieldVariants` and
 * the panel reuses the Select's content and item variants, so it is visually
 * identical to Forms/Select Basic with a search row added.
 *
 * ```tsx
 * <Combobox label="Country" options={countries} searchPlaceholder="Search" />
 * ```
 */
export function Combobox({
  options,
  value: controlledValue,
  defaultValue,
  onValueChange,
  label,
  required = false,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyMessage = "No results found",
  helperText,
  error,
  disabled = false,
  size = "md",
  clearable = false,
  className,
  wrapperClassName,
  ...rest
}: ComboboxProps) {
  const autoId = useId();
  const triggerId = `combobox-${autoId}`;
  const errorId = `${triggerId}-error`;
  const helperId = `${triggerId}-helper`;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolled;
  const hasError = Boolean(error);

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const commit = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);
      setOpen(false);
      setSearch("");
      // Return focus to the trigger so keyboard users are not dropped at the
      // top of the document after the popover unmounts.
      triggerRef.current?.focus();
    },
    [isControlled, onValueChange]
  );

  const groups = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const o of options) {
      const key = o.group ?? "";
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return [...map.entries()];
  }, [options]);

  const describedBy =
    [hasError ? errorId : null, helperText && !hasError ? helperId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const state = disabled ? "disabled" : hasError ? "error" : "default";

  return (
    <div className={cn("flex w-full flex-col gap-1", wrapperClassName)}>
      {label ? (
        <label
          htmlFor={triggerId}
          className={cn(
            "flex items-center gap-0.5 text-caption-1-semibold",
            disabled ? "text-fg-subtle" : "text-fg-muted"
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
            ref={triggerRef}
            id={triggerId}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${triggerId}-listbox`}
            aria-autocomplete="list"
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-errormessage={hasError ? errorId : undefined}
            disabled={disabled}
            className={cn(
              inputFieldVariants({ size, state }),
              "justify-between text-left",
              "outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-active-500",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
              className
            )}
            {...rest}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                selected ? "text-fg" : "text-border-strong"
              )}
            >
              {selected?.label ?? placeholder}
            </span>

            {clearable && selected && !disabled ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear selection"
                className="flex items-center rounded p-0.5 text-fg-muted hover:bg-elevated-hover"
                onPointerDown={(e) => {
                  // Stop the popover trigger from opening on the same press.
                  e.preventDefault();
                  e.stopPropagation();
                  commit("");
                }}
              >
                <X aria-hidden="true" className="size-4" />
              </span>
            ) : null}

            <ChevronDown
              aria-hidden="true"
              className={cn(
                "shrink-0 text-fg-muted transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-180"
              )}
            />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className={cn(
              selectContentVariants({ matchTrigger: false }),
              "w-[var(--radix-popover-trigger-width)] p-0",
              // Radix defers unmount until the exit animation fires
              // `animationend`. Inside a Popover that event does not arrive
              // reliably, which left a closed panel mounted with
              // `pointer-events: auto` on every open. Dropping the exit
              // animation makes the unmount synchronous. The enter animation
              // is kept, which is the one users actually perceive.
              "data-[state=closed]:animate-none"
            )}
            // Radix would focus the panel itself. Redirect to the search box
            // so the user can type immediately, which is the whole point of a
            // searchable select. preventDefault alone would leave focus on the
            // body and break keyboard use entirely.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              searchRef.current?.focus();
            }}
          >
            <CommandPrimitive
              // cmdk's own filter is replaced by keyword-aware matching so
              // `keywords` on an option participate in the search.
              filter={(itemValue, searchTerm, keywords) => {
                const haystack = [itemValue, ...(keywords ?? [])].join(" ").toLowerCase();
                return haystack.includes(searchTerm.toLowerCase()) ? 1 : 0;
              }}
              className="flex flex-col"
            >
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                <CommandPrimitive.Input
                  ref={searchRef}
                  value={search}
                  onValueChange={setSearch}
                  placeholder={searchPlaceholder}
                  className={cn(
                    "h-10 min-w-0 flex-1 bg-transparent",
                    "text-subhead-regular text-fg placeholder:text-border-strong",
                    "border-0 outline-none"
                  )}
                />
              </div>

              <CommandPrimitive.List
                id={`${triggerId}-listbox`}
                className="max-h-64 overflow-y-auto overscroll-contain p-1"
              >
                <CommandPrimitive.Empty className="px-2 py-6 text-center text-subhead-regular text-fg-subtle">
                  {emptyMessage}
                </CommandPrimitive.Empty>

                {groups.map(([groupName, items]) => (
                  <CommandPrimitive.Group
                    key={groupName || "ungrouped"}
                    heading={groupName || undefined}
                    className={cn(
                      "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
                      "[&_[cmdk-group-heading]]:text-caption-1-semibold",
                      "[&_[cmdk-group-heading]]:text-fg-muted"
                    )}
                  >
                    {items.map((o) => (
                      <CommandPrimitive.Item
                        key={o.value}
                        value={o.label}
                        keywords={o.keywords}
                        disabled={o.disabled}
                        onSelect={() => commit(o.value)}
                        className={cn(
                          selectItemVariants({ size: "md" }),
                          "aria-selected:bg-elevated-hover"
                        )}
                      >
                        {o.icon ? (
                          <span aria-hidden="true" className="flex items-center text-fg-muted">
                            {o.icon}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.value === value ? (
                          <Check
                            aria-hidden="true"
                            className="size-4 shrink-0 text-active-500"
                            strokeWidth={3}
                          />
                        ) : null}
                      </CommandPrimitive.Item>
                    ))}
                  </CommandPrimitive.Group>
                ))}
              </CommandPrimitive.List>
            </CommandPrimitive>
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
