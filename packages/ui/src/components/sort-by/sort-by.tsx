"use client";

import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from "../select";

/**
 * SortBy - Pencil frame `qyjm1` ("Forms/Sort by").
 *
 * A compact inline control for choosing a sort order - the kind that sits in
 * a toolbar above a table, not in a form. Measured:
 *
 *   row       gap 4, horizontal
 *   label     12px SemiBold, #9da2a7 / #55585a -> `fg-subtle`, padding 2 0
 *   trigger   h22, radius 12, padding 2 4, gap 4
 *             text 12px SemiBold, #727880 / #898f96 -> `fg-muted`
 *             chevron 12px; no background at rest
 *   hover     #f5f5f5 / #26282a -> `surface`
 *   open      same as hover
 *   disabled  label and value both drop to `fg-subtle`
 *   panel     radius 12, padding 4, gap 2, `elevated`, two shadows
 *   row       h34, radius 8, padding 8, gap 8, 12px Regular
 *
 * The panel and its rows are the Select's own `sm` size, which already
 * measures 34 tall at radius 8 with 8px padding - the same frame the Droplist
 * came from. Only the trigger differs, so only the trigger is restyled.
 */

export interface SortByOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface SortByProps {
  options: SortByOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Caption to the left of the trigger. */
  label?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  "data-testid"?: string;
}

export function SortBy({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  required = false,
  disabled = false,
  placeholder = "Choice Input",
  className,
  wrapperClassName,
  ...rest
}: SortByProps) {
  const autoId = useId();
  const triggerId = `sortby-${autoId}`;
  const labelId = `${triggerId}-label`;

  return (
    <div className={cn("flex items-center gap-1", wrapperClassName)}>
      {label ? (
        <span
          id={labelId}
          className={cn(
            "flex shrink-0 items-center gap-0.5 py-0.5 text-caption-1-semibold",
            "text-fg-subtle",
          )}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className={disabled ? "text-fg-subtle" : "text-danger"}>
              *
            </span>
          ) : null}
        </span>
      ) : null}

      <SelectRoot
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          id={triggerId}
          // The caption is a sibling, not a <label>, because the trigger is a
          // button - so the association is made explicitly.
          aria-labelledby={label ? `${labelId} ${triggerId}` : undefined}
          disabled={disabled}
          className={cn(
            // Overrides the shared field geometry down to the frame's compact
            // trigger. The chevron, its rotate-on-open and the value slot all
            // come from SelectTrigger unchanged - only the box is restyled.
            "h-[22px] w-auto gap-1 rounded-xl px-1 py-0.5",
            "text-caption-1-semibold [&_svg]:size-3",
            "bg-transparent inset-ring-0",
            disabled ? "cursor-not-allowed text-fg-subtle" : "cursor-pointer text-fg-muted",
            "transition-colors duration-150 motion-reduce:transition-none",
            !disabled && "hover:bg-surface data-[state=open]:bg-surface",
            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
            className,
          )}
          {...rest}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent matchTrigger={false} className="min-w-[70px]">
          {options.map((o) => (
            // The icon goes through `startIcon`, not as a child: children are
            // wrapped in Radix's ItemText, where a block-level SVG stacks
            // above the label instead of sitting beside it (50px rows rather
            // than the frame's 34).
            <SelectItem key={o.value} value={o.value} size="sm" startIcon={o.icon}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectRoot>
    </div>
  );
}
