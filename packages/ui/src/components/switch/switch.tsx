"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  switchThumbVariants,
  switchTrackVariants,
  type SwitchVariantProps,
} from "./switch.variants";

export interface SwitchProps
  extends Omit<ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, "children">,
    SwitchVariantProps {
  /** Label beside the track. Omit for a bare switch, then pass `aria-label`. */
  label?: ReactNode;
  /** Rendered after the label in accent colour. */
  link?: ReactNode;
  /** Short hint under the label. */
  description?: ReactNode;
  /** Put the label before the switch, e.g. in settings rows. */
  labelPosition?: "start" | "end";
  /** Class for the outer wrapper. `className` targets the track. */
  wrapperClassName?: string;
}

/**
 * Switch, transcribed from the Pencil design file (Toogle, WSheb).
 *
 * ```tsx
 * <Switch label="Toggle Text" link="Text Link" />
 * <Switch size="md" checked={on} onCheckedChange={setOn} />
 * ```
 *
 * Animates only the knob's transform and the track colour, both of which are
 * suppressed under `prefers-reduced-motion`.
 */
export const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch(
  {
    id,
    label,
    link,
    description,
    labelPosition = "end",
    size,
    className,
    wrapperClassName,
    disabled,
    ...props
  },
  ref
) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const descId = `${switchId}-description`;

  const labelNode =
    label || link ? (
      <label
        htmlFor={switchId}
        className={cn(
          "flex flex-wrap items-center gap-1 text-subhead-regular",
          disabled ? "cursor-not-allowed text-fg-subtle" : "cursor-pointer text-fg"
        )}
      >
        {label}
        {link ? <span className="text-active-500">{link}</span> : null}
      </label>
    ) : null;

  return (
    <div className={cn("flex flex-col gap-1", wrapperClassName)}>
      <div
        className={cn(
          "flex items-center gap-2",
          labelPosition === "start" && "flex-row-reverse justify-between"
        )}
      >
        <SwitchPrimitive.Root
          ref={ref}
          id={switchId}
          disabled={disabled}
          aria-describedby={description ? descId : undefined}
          className={cn(switchTrackVariants({ size }), className)}
          {...props}
        >
          <SwitchPrimitive.Thumb className={cn(switchThumbVariants({ size }))} />
        </SwitchPrimitive.Root>
        {labelNode}
      </div>

      {description ? (
        <p id={descId} className="text-caption-2-regular text-fg-subtle">
          {description}
        </p>
      ) : null}
    </div>
  );
});
