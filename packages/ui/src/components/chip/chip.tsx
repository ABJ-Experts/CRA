import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Chip — Pencil frame `MbrZH`.
 *
 * A single geometry, one variant per theme:
 *   h 32, radius 12, padding [4,8], gap 8
 *   bg    #f5f5f5 / #26282a -> `surface`
 *   label #727880 / #898f96 -> `fg-muted`, 14px Medium -> `subhead-medium`
 *   media 24px avatar slot, remove icon 12px
 *
 * Unlike `Tag`, a chip represents a *removable selection* (a recipient, a
 * filter, a picked user), which is why it carries a leading avatar slot and a
 * trailing dismiss control.
 *
 * Two deliberate deviations, both for the same reason the Switch knob deviates:
 *  - the design's `close-circle` glyph is a hardcoded `#1b1d1f`, invisible on
 *    the dark chip. Here it inherits `currentColor`.
 *  - the design defines no hover state for the dismiss control. A destructive
 *    control with zero feedback is not shippable, so it gets a subtle
 *    `elevated-hover` wash and a focus ring.
 */

export interface ChipProps extends Omit<ComponentProps<"span">, "onSelect"> {
  /** 24px leading slot: an avatar, a favicon, an icon. */
  avatar?: ReactNode;
  /**
   * Renders the dismiss button and is called when it is activated. Omit for a
   * read-only chip.
   */
  onRemove?: () => void;
  /**
   * Accessible name for the dismiss button. Defaults to `Remove`, but pass
   * something specific when several chips sit together, so a screen reader
   * announces which one is being removed.
   */
  removeLabel?: string;
  disabled?: boolean;
}

export function Chip({
  avatar,
  onRemove,
  removeLabel = "Remove",
  disabled = false,
  className,
  children,
  ...props
}: ChipProps) {
  return (
    <span
      data-disabled={disabled || undefined}
      className={cn(
        "inline-flex h-8 max-w-full shrink-0 items-center gap-2 align-middle",
        "rounded-xl bg-surface px-2 py-1",
        "text-subhead-medium text-fg-muted",
        disabled && "opacity-50",
        className
      )}
      {...props}
    >
      {avatar ? (
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {avatar}
        </span>
      ) : null}

      <span className="min-w-0 truncate">{children}</span>

      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full p-0.5",
            "text-fg-muted transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-elevated-hover hover:text-fg",
            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
            "disabled:cursor-not-allowed disabled:hover:bg-transparent"
          )}
        >
          <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
        </button>
      ) : null}
    </span>
  );
}
