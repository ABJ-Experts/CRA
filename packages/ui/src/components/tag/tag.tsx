import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  tagDotVariants,
  tagVariants,
  type TagTone,
  type TagVariantProps,
} from "./tag.variants";

export interface TagProps
  extends Omit<ComponentProps<"span">, "color">,
    Omit<TagVariantProps, "tone"> {
  /**
   * Palette family. Applies to `fill` (300-step background) and `dot`
   * (500-step marker); `cool` is monochrome and ignores it.
   *
   * Defaults per the design: `purple` for fill, `blue` for dot.
   */
  tone?: TagTone;
  /** Leading icon. Ignored by `variant="dot"`, which draws its own marker. */
  icon?: ReactNode;
}

/**
 * A non-interactive label. Pencil frame `l9QDb`.
 *
 * ```tsx
 * <Tag icon={<Hash />}>Design</Tag>
 * <Tag variant="fill" tone="green" icon={<Hash />}>Shipped</Tag>
 * <Tag variant="dot" tone="red">Blocked</Tag>
 * ```
 *
 * Renders a `<span>`, so it is safe inside a button, link or heading. If you
 * need a removable tag, that is `Chip`.
 *
 * Deliberate deviation from the design: the hashtag glyph in the Pencil frame
 * is a hardcoded `#1b1d1f`, which renders as near-invisible ink-on-charcoal in
 * the Dark Mode=On variants. Here the icon inherits `currentColor`, so it
 * tracks the label in both themes. Same call as the Switch knob.
 */
export function Tag({
  variant = "cool",
  size = "md",
  tone,
  icon,
  className,
  children,
  ...props
}: TagProps) {
  // The design's two defaults come from different palette families, so the
  // fallback depends on the variant rather than being a single CVA default.
  const resolvedTone: TagTone = tone ?? (variant === "dot" ? "blue" : "purple");

  return (
    <span
      className={cn(tagVariants({ variant, size, tone: resolvedTone }), className)}
      {...props}
    >
      {variant === "dot" ? (
        <span
          aria-hidden="true"
          className={tagDotVariants({ size, tone: resolvedTone })}
        />
      ) : (
        icon
      )}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
