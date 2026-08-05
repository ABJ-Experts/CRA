"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { radioVariants, type RadioVariantProps } from "./radio.variants";

/** Lets RadioGroup pass `size` down without repeating it on every item. */
const RadioSizeContext = createContext<RadioVariantProps["size"]>("md");

export interface RadioGroupProps
  extends ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>, RadioVariantProps {
  /** Accessible name for the group. Required unless `aria-labelledby` is set. */
  label?: ReactNode;
  /** Short hint under the group. */
  description?: ReactNode;
  /** Error message. Sets `aria-invalid` on the group. */
  error?: ReactNode;
}

/**
 * Radio group, transcribed from the Pencil design file.
 *
 * Radix handles roving tabindex, so the group is one tab stop and the arrow
 * keys move between options, which is the expected radio behaviour.
 *
 * ```tsx
 * <RadioGroup label="Plan" defaultValue="pro">
 *   <Radio value="free" label="Free" />
 *   <Radio value="pro" label="Pro" link="Compare" />
 * </RadioGroup>
 * ```
 */
export const RadioGroup = forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(function RadioGroup(
  { className, label, description, error, size = "md", children, ...props },
  ref,
) {
  const autoId = useId();
  const groupId = `radiogroup-${autoId}`;
  const labelId = `${groupId}-label`;
  const errorId = `${groupId}-error`;
  const descId = `${groupId}-description`;
  const hasError = Boolean(error);

  const describedBy =
    [hasError ? errorId : null, description ? descId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <span id={labelId} className="text-caption-1-semibold text-fg-muted">
          {label}
        </span>
      ) : null}

      <RadioSizeContext.Provider value={size}>
        <RadioGroupPrimitive.Root
          ref={ref}
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-errormessage={hasError ? errorId : undefined}
          className={cn("flex flex-col gap-2", className)}
          {...props}
        >
          {children}
        </RadioGroupPrimitive.Root>
      </RadioSizeContext.Provider>

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

export interface RadioProps
  extends
    Omit<ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, "children">,
    RadioVariantProps {
  /** Label beside the control. */
  label?: ReactNode;
  /** Rendered after the label in accent colour. */
  link?: ReactNode;
  /** Short hint under the label. */
  description?: ReactNode;
  /** Class for the row wrapper. `className` targets the control. */
  wrapperClassName?: string;
}

/** A single option. Must be rendered inside a `RadioGroup`. */
export const Radio = forwardRef<React.ComponentRef<typeof RadioGroupPrimitive.Item>, RadioProps>(
  function Radio(
    { id, label, link, description, size, className, wrapperClassName, disabled, ...props },
    ref,
  ) {
    const autoId = useId();
    const radioId = id ?? `radio-${autoId}`;
    const descId = `${radioId}-description`;
    const inherited = useContext(RadioSizeContext);
    const resolved = size ?? inherited;

    return (
      <div className={cn("flex flex-col gap-1", wrapperClassName)}>
        <div className="flex items-start gap-2">
          <RadioGroupPrimitive.Item
            ref={ref}
            id={radioId}
            disabled={disabled}
            aria-describedby={description ? descId : undefined}
            className={cn(radioVariants({ size: resolved }), className)}
            {...props}
          />

          {label || link ? (
            <label
              htmlFor={radioId}
              className={cn(
                "flex flex-wrap items-center gap-1 text-subhead-regular",
                disabled ? "cursor-not-allowed text-fg-subtle" : "cursor-pointer text-fg",
              )}
            >
              {label}
              {link ? <span className="text-active-500">{link}</span> : null}
            </label>
          ) : null}
        </div>

        {description ? (
          <p id={descId} className="pl-7 text-caption-2-regular text-fg-subtle">
            {description}
          </p>
        ) : null}
      </div>
    );
  },
);
