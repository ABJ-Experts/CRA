import { cn } from "@repo/ui/cn";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The small shared pieces of the auth form column, all measured from the
 * Admin Authorization frames:
 *
 *   logo band  480x120, mark at (60,40), 151.67x40
 *   title      28/500 -> `text-h4` + `fg`, sub 12/400 -> `caption-1-regular`
 *   footer     480x72, padding [24,0], gap 4, 14px body + a 14/600 link
 */

export function AuthLogo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-3 rounded-lg",
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-active-500 text-headline-semibold text-white">
        C
      </span>
      <span className="text-h5 text-fg">CRA</span>
    </Link>
  );
}

export function AuthTitle({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h1 className="text-h4 text-fg">{title}</h1>
      {description ? (
        <p className="text-caption-1-regular text-fg-muted">{description}</p>
      ) : null}
    </div>
  );
}

export function AuthFooter({
  prompt,
  href,
  action,
}: {
  prompt: ReactNode;
  href: string;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center justify-center gap-1 py-6">
      <span className="text-subhead-regular text-fg">{prompt}</span>
      <Link
        href={href}
        className={cn(
          "rounded-xl px-0.5 py-px text-subhead-semibold text-active-500",
          "transition-colors duration-150 motion-reduce:transition-none",
          "hover:text-active-600",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        )}
      >
        {action}
      </Link>
    </div>
  );
}

/**
 * The "or sign in with" rule: two hairlines with a 10/600 `border-strong`
 * label between them.
 */
export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0 text-caption-2-semibold text-border-strong">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
