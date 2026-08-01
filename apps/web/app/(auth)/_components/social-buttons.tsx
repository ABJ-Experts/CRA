"use client";

import { cn } from "@repo/ui/cn";
import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The provider buttons: 360x48, radius 12, padding [14,44,13,16], gap 8,
 * 1px `border`, label 14/600 `fg-muted`.
 *
 * Not the shared Button: its `lg` is 48 tall but pads [16,24] and uses a
 * 16/600 label, and the design's asymmetric [14,44,13,16] exists so the
 * centred label optically balances against the leading mark. Forcing the
 * Button into that shape needs more overrides than the button itself is.
 */

function SocialButton({
  icon,
  children,
  onClick,
  disabled,
  ...rest
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-12 w-full items-center justify-center gap-2",
        "rounded-xl border border-border bg-canvas",
        "pt-[14px] pr-11 pb-[13px] pl-4",
        "text-subhead-semibold text-fg-muted",
        "transition-colors duration-150 motion-reduce:transition-none",
        "hover:bg-surface hover:text-fg",
        "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-canvas"
      )}
      {...rest}
    >
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-center">{children}</span>
    </button>
  );
}

/** Google's mark, inlined so it keeps its brand colours in both themes. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

export function SocialButtons({
  action = "Sign In",
  disabled,
  onGoogle,
  onSso,
}: {
  /** "Sign In" or "Sign Up", matching the frame's two labels. */
  action?: "Sign In" | "Sign Up";
  disabled?: boolean;
  onGoogle?: () => void;
  onSso?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SocialButton
        icon={<GoogleMark />}
        disabled={disabled}
        onClick={onGoogle}
        data-testid="social-google"
      >
        {action} with Google
      </SocialButton>
      <SocialButton
        icon={<KeyRound className="size-4 text-fg-muted" />}
        disabled={disabled}
        onClick={onSso}
        data-testid="social-sso"
      >
        {action} with SSO
      </SocialButton>
    </div>
  );
}
