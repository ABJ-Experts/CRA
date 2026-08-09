"use client";

import { Slot, Slottable } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { buttonVariants, type ButtonVariantProps } from "./button.variants";

export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    ButtonVariantProps {
  /** Render the child element instead of a `<button>`, keeping all styling. */
  asChild?: boolean;
  /** Icon before the label. Sized automatically per `size`. */
  startIcon?: ReactNode;
  /** Icon after the label. Sized automatically per `size`. */
  endIcon?: ReactNode;
  /**
   * Vertical hairline between the label and `endIcon`.
   * Present on the Fill variants in the design (1px, scrim-white-15).
   */
  withDivider?: boolean;
  /** Swap the start icon for a spinner and block interaction. */
  loading?: boolean;
  /** Announced while `loading`. Defaults to "Loading". */
  loadingLabel?: string;
}

/**
 * Button, transcribed from the Pencil design file.
 *
 * ```tsx
 * <Button>Save</Button>
 * <Button variant="outline" tone="grey" startIcon={<ArrowLeft />}>Back</Button>
 * <Button iconOnly aria-label="Close"><X /></Button>
 * <Button asChild><Link href="/">Home</Link></Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      tone,
      size,
      iconOnly,
      fullWidth,
      asChild = false,
      startIcon,
      endIcon,
      withDivider = false,
      loading = false,
      loadingLabel = "Loading",
      disabled,
      onClick,
      tabIndex,
      children,
      type,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled === true || loading;
    const preventDisabledActivation: MouseEventHandler<HTMLButtonElement> = (
      event,
    ) => {
      event.preventDefault();
      event.stopPropagation();
    };

    return (
      <Comp
        ref={ref}
        // `asChild` may render an <a>, which has no implicit type.
        type={asChild ? type : (type ?? "button")}
        disabled={asChild ? undefined : isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={loading || undefined}
        tabIndex={isDisabled && asChild ? -1 : tabIndex}
        onClick={isDisabled && asChild ? preventDisabledActivation : onClick}
        data-loading={loading ? "" : undefined}
        className={cn(
          buttonVariants({ variant, tone, size, iconOnly, fullWidth }),
          // Mirrors the disabled: styles for asChild, where :disabled cannot match.
          isDisabled && asChild && "pointer-events-none opacity-60",
          className,
        )}
        {...props}
      >
        {/*
          These are deliberately direct children rather than a Fragment.
          Radix `Slot` only inspects its immediate children for `Slottable`,
          so wrapping them would hide it and the consumer's element would
          render unstyled.
        */}
        {loading ? (
          <Loader2
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          startIcon
        )}

        {asChild ? <Slottable>{children}</Slottable> : children}

        {/*
          `endIcon` is required, not just `withDivider`. In the design the
          hairline always sits BETWEEN the label and a trailing icon, so with
          no icon to separate it renders as a stray white bar floating at the
          button's right edge. Gating on the icon makes that unrepresentable.
        */}
        {withDivider && !iconOnly && endIcon ? (
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-scrim-white-15"
          />
        ) : null}

        {iconOnly ? null : endIcon}

        {loading ? <span className="sr-only">{loadingLabel}</span> : null}
      </Comp>
    );
  },
);
