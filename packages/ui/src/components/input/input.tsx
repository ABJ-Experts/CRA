"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  inputControlVariants,
  inputFieldVariants,
  type InputFieldVariantProps,
} from "./input.variants";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible label. Omit for a bare field, but then pass `aria-label`. */
  label?: ReactNode;
  /** Marks the field required and renders the design's danger asterisk. */
  required?: boolean;
  /** Visually hide the label while keeping it for assistive tech. */
  hideLabel?: boolean;
  /** Icon before the control. Sized automatically per `size`. */
  startIcon?: ReactNode;
  /** Icon or control after the input, e.g. a password toggle. */
  endIcon?: ReactNode;
  /** Short hint rendered under the field. Hidden while `error` is set. */
  helperText?: ReactNode;
  /**
   * Error message. Any truthy value puts the field in its error state,
   * sets `aria-invalid`, and wires the message via `aria-describedby`.
   */
  error?: ReactNode;
  /** 40px (`md`), 48px (`lg`) or 56px (`xl`). */
  size?: InputFieldVariantProps["size"];
  /** Class for the outer wrapper. `className` targets the field itself. */
  wrapperClassName?: string;
}

/**
 * Text input, transcribed from the Pencil design file.
 *
 * ```tsx
 * <Input label="Email" required placeholder="you@example.com" />
 * <Input label="Password" startIcon={<Lock />} error="Required" />
 * ```
 *
 * Works controlled or uncontrolled. The ref forwards to the `<input>`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id,
    label,
    required = false,
    hideLabel = false,
    startIcon,
    endIcon,
    helperText,
    error,
    size = "md",
    disabled = false,
    className,
    wrapperClassName,
    ...props
  },
  ref
) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const hasError = Boolean(error);
  const state = disabled ? "disabled" : hasError ? "error" : "default";

  // Only reference ids that are actually rendered, or screen readers announce
  // a dangling reference.
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
            hideLabel && "sr-only"
          )}
        >
          {label}
          {required ? (
            // aria-hidden because the control already carries `required`.
            <span aria-hidden="true" className={disabled ? "text-fg-subtle" : "text-danger"}>
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <div className={cn(inputFieldVariants({ size, state }), className)}>
        {startIcon ? (
          <span aria-hidden="true" className="flex items-center text-fg-muted">
            {startIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-errormessage={hasError ? errorId : undefined}
          className={cn(inputControlVariants({ size }))}
          {...props}
        />

        {endIcon ? <span className="flex items-center text-fg-muted">{endIcon}</span> : null}
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
});
