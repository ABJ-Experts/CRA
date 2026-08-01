"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { checkboxVariants, type CheckboxVariantProps } from "./checkbox.variants";

export interface CheckboxProps
  extends Omit<ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "children">,
    CheckboxVariantProps {
  /** Label beside the box. Omit for a bare box, then pass `aria-label`. */
  label?: ReactNode;
  /** Rendered after the label in accent colour, e.g. "Terms of Service". */
  link?: ReactNode;
  /** Short hint under the label. */
  description?: ReactNode;
  /** Error message. Sets `aria-invalid` and renders in the danger tone. */
  error?: ReactNode;
  /** Class for the outer wrapper. `className` targets the box itself. */
  wrapperClassName?: string;
}

/**
 * Checkbox, transcribed from the Pencil design file.
 *
 * Supports checked, unchecked and indeterminate, controlled or uncontrolled.
 *
 * ```tsx
 * <Checkbox label="Checkbox Text" link="Text Link" />
 * <Checkbox checked="indeterminate" label="Select all" />
 * ```
 */
export const Checkbox = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox(
  {
    id,
    label,
    link,
    description,
    error,
    size,
    className,
    wrapperClassName,
    disabled,
    ...props
  },
  ref
) {
  const autoId = useId();
  const boxId = id ?? `checkbox-${autoId}`;
  const errorId = `${boxId}-error`;
  const descId = `${boxId}-description`;
  const hasError = Boolean(error);

  const describedBy =
    [hasError ? errorId : null, description ? descId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-1", wrapperClassName)}>
      <div className="flex items-start gap-2">
        <CheckboxPrimitive.Root
          ref={ref}
          id={boxId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-errormessage={hasError ? errorId : undefined}
          className={cn(checkboxVariants({ size }), className)}
          {...props}
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
            {/*
              Radix renders the indicator for both checked and indeterminate,
              so the glyph is chosen from the resolved state rather than by
              rendering two indicators.
            */}
            {props.checked === "indeterminate" ? (
              <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
            ) : (
              <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
            )}
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>

        {label || link ? (
          <label
            htmlFor={boxId}
            className={cn(
              "flex flex-wrap items-center gap-1 text-subhead-regular",
              disabled ? "cursor-not-allowed text-fg-subtle" : "cursor-pointer text-fg"
            )}
          >
            {label}
            {link ? <span className="text-active-500">{link}</span> : null}
          </label>
        ) : null}
      </div>

      {hasError ? (
        <p id={errorId} role="alert" className="text-caption-2-regular text-danger">
          {error}
        </p>
      ) : description ? (
        <p id={descId} className="text-caption-2-regular text-fg-subtle">
          {description}
        </p>
      ) : null}
    </div>
  );
});
