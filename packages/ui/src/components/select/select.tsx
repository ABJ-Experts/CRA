"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { inputFieldVariants } from "../input/input.variants";
import {
  selectContentVariants,
  selectItemVariants,
  type SelectContentVariantProps,
  type SelectItemVariantProps,
} from "./select.variants";

/* Re-exported primitives for advanced composition. */
export const SelectRoot = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export interface SelectTriggerProps extends ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {
  /** 40px (`md`), 48px (`lg`) or 56px (`xl`), matching the Input sizes. */
  size?: "md" | "lg" | "xl";
  /** Puts the trigger in the danger state. */
  invalid?: boolean;
  /**
   * Leading slot, rendered OUTSIDE the truncating value span - an avatar, a
   * flag, a colour swatch. Passing one as a child instead would nest it in
   * that span, where it stacks above the value rather than sitting beside it.
   */
  startIcon?: ReactNode;
}

export const SelectTrigger = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger(
  { className, children, size = "md", invalid, disabled, startIcon, ...props },
  ref,
) {
  const state = disabled ? "disabled" : invalid ? "error" : "default";
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={cn(
        // Identical geometry and stroke states to the Input field.
        inputFieldVariants({ size, state }),
        "justify-between text-left",
        "data-[placeholder]:text-border-strong",
        "outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-active-500",
        disabled
          ? "cursor-not-allowed text-fg-subtle"
          : "cursor-pointer text-fg",
        className,
      )}
      {...props}
    >
      {startIcon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden="true"
          className="text-fg-muted transition-transform duration-150 group-data-[state=open]/field:rotate-180 motion-reduce:transition-none"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export interface SelectContentProps
  extends
    ComponentPropsWithoutRef<typeof SelectPrimitive.Content>,
    SelectContentVariantProps {}

export const SelectContent = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(function SelectContent(
  {
    className,
    children,
    matchTrigger,
    position = "popper",
    sideOffset = 4,
    ...props
  },
  ref,
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={sideOffset}
        className={cn(selectContentVariants({ matchTrigger }), className)}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-fg-muted">
          <ChevronUp aria-hidden="true" className="size-4" />
        </SelectPrimitive.ScrollUpButton>

        {/* Caps the panel so a long list scrolls instead of overflowing. */}
        <SelectPrimitive.Viewport className="max-h-[--radix-select-content-available-height] overflow-y-auto">
          {children}
        </SelectPrimitive.Viewport>

        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-fg-muted">
          <ChevronDown aria-hidden="true" className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export interface SelectItemProps
  extends
    ComponentPropsWithoutRef<typeof SelectPrimitive.Item>,
    SelectItemVariantProps {
  /** Icon or avatar before the label, as the Droplist design shows. */
  startIcon?: ReactNode;
  /**
   * Secondary line under the label.
   *
   * Deliberately NOT part of `children`: Radix mirrors whatever sits inside
   * `ItemText` into the closed trigger, so a description passed as a child
   * would make the trigger read "Wade WarrenEngineering".
   */
  description?: ReactNode;
}

export const SelectItem = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  SelectItemProps
>(function SelectItem(
  { className, children, size, startIcon, description, ...props },
  ref,
) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(selectItemVariants({ size }), className)}
      {...props}
    >
      {startIcon ? (
        <span aria-hidden="true" className="flex items-center text-fg-muted">
          {startIcon}
        </span>
      ) : null}
      {description ? (
        <span className="flex min-w-0 flex-col">
          <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
          <span className="truncate text-caption-2-regular text-fg-subtle">
            {description}
          </span>
        </span>
      ) : (
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      )}
      <SelectPrimitive.ItemIndicator className="ml-auto flex items-center">
        <Check aria-hidden="true" className="size-4" strokeWidth={3} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});

export const SelectSeparator = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

export const SelectLabel = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn(
        "px-2 py-1.5 text-caption-1-semibold text-fg-muted",
        className,
      )}
      {...props}
    />
  );
});

export interface SelectProps extends ComponentPropsWithoutRef<
  typeof SelectPrimitive.Root
> {
  /** Visible label above the trigger. */
  label?: ReactNode;
  /** Marks required and renders the danger asterisk. */
  required?: boolean;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Hint under the field. Hidden while `error` is set. */
  helperText?: ReactNode;
  /** Error message. Puts the trigger in the danger state. */
  error?: ReactNode;
  /** 40px (`md`), 48px (`lg`) or 56px (`xl`). */
  size?: "md" | "lg" | "xl";
  /** Class for the trigger. */
  className?: string;
  /** Class for the outer wrapper. */
  wrapperClassName?: string;
}

/**
 * Select with label, helper and error, matching Forms/Select Basic.
 *
 * ```tsx
 * <Select label="Country" required placeholder="Select">
 *   <SelectItem value="uk">United Kingdom</SelectItem>
 * </Select>
 * ```
 *
 * For full control over the trigger or panel, compose the exported
 * `SelectRoot` / `SelectTrigger` / `SelectContent` primitives directly.
 */
export function Select({
  label,
  required = false,
  placeholder = "Select",
  helperText,
  error,
  size = "md",
  className,
  wrapperClassName,
  children,
  disabled,
  ...props
}: SelectProps) {
  const autoId = useId();
  const triggerId = `select-${autoId}`;
  const errorId = `${triggerId}-error`;
  const helperId = `${triggerId}-helper`;
  const hasError = Boolean(error);

  // Radix's Root renders no DOM, so `data-*` and `aria-*` attributes passed here
  // would be silently dropped. Only accessible naming/description attributes
  // are safe to route to the trigger: state attributes remain Radix-owned.
  const rootProps: Record<string, unknown> = {};
  const triggerProps: Record<string, unknown> = {};
  let callerDescribedBy: string | undefined;
  for (const [key, val] of Object.entries(props)) {
    if (
      key.startsWith("data-") ||
      key === "aria-label" ||
      key === "aria-labelledby"
    ) {
      triggerProps[key] = val;
    } else if (key === "aria-describedby") {
      callerDescribedBy = typeof val === "string" ? val : undefined;
    } else if (!key.startsWith("aria-")) {
      rootProps[key] = val;
    }
  }
  const describedBy =
    [
      callerDescribedBy,
      hasError ? errorId : null,
      helperText && !hasError ? helperId : null,
    ]
      .flatMap((value) => (typeof value === "string" ? value.split(/\s+/) : []))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
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
            <span
              aria-hidden="true"
              className={disabled ? "text-fg-subtle" : "text-danger"}
            >
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <SelectPrimitive.Root
        disabled={disabled}
        required={required}
        {...rootProps}
      >
        <SelectTrigger
          {...triggerProps}
          id={triggerId}
          size={size}
          invalid={hasError}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-errormessage={hasError ? errorId : undefined}
          className={className}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </SelectPrimitive.Root>

      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="text-caption-2-regular text-danger"
        >
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
