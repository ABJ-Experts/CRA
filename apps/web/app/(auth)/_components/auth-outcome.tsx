import { cn } from "@repo/ui/cn";
import type { ReactNode } from "react";

/**
 * The shared shape of the three outcome screens (check-email, success,
 * expired): a tinted glyph, the title block, then actions.
 *
 * The Pencil file has no banner or inline-alert component, and the library's
 * `Alert` is a confirmation dialog, so this composes the same tokens the
 * status colours already define rather than inventing a new primitive.
 */
export function AuthOutcome({
  tone = "accent",
  icon,
  title,
  description,
  children,
}: {
  tone?: "accent" | "success" | "danger" | "warning";
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    accent: "bg-accent-subtle text-active-500",
    success: "bg-success-surface text-success-fg",
    danger: "bg-danger-surface text-danger-fg",
    warning: "bg-warning-surface text-warning-fg",
  } as const;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-12 items-center justify-center rounded-xl",
            tones[tone],
          )}
        >
          {icon}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-h4 text-fg">{title}</h1>
          {description ? (
            <p className="text-caption-1-regular text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children ? <div className="flex flex-col gap-4">{children}</div> : null}
    </div>
  );
}
