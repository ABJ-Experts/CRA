"use client";

import { usePathname } from "next/navigation";
import { AuthFooter } from "./auth-chrome";

/**
 * The bottom band of the form column.
 *
 * In the frames this is pinned at y=952, below the vertically-centred form,
 * so it belongs to the layout rather than to any page. A Next layout cannot
 * take a second slot from its children without parallel routes, so the
 * mapping lives here: one table, in one place, instead of every page
 * re-declaring a footer that is meant to be part of the shell.
 *
 * Forgot Password has no footer in the design, which is why its panel is 904
 * tall rather than 832. Routes absent from the table render nothing.
 */
const FOOTERS: Record<string, { prompt: string; href: string; action: string } | undefined> = {
  "/sign-in": {
    prompt: "Don’t have an account?",
    href: "/sign-up",
    action: "Sign Up",
  },
  "/sign-up": {
    prompt: "Already have an account?",
    href: "/sign-in",
    action: "Sign In",
  },
  "/lock": {
    prompt: "Not you?",
    href: "/sign-in",
    action: "Sign In",
  },
  "/verify": {
    prompt: "Wrong address?",
    href: "/sign-up",
    action: "Start over",
  },
  "/two-factor": {
    prompt: "Cannot access your app?",
    href: "/sign-in",
    action: "Sign In",
  },
  "/check-email": {
    prompt: "Wrong address?",
    href: "/forgot-password",
    action: "Try again",
  },
  "/expired": {
    prompt: "Remembered it?",
    href: "/sign-in",
    action: "Sign In",
  },
};

export function AuthFooterSlot() {
  const pathname = usePathname();
  const footer = FOOTERS[pathname];
  if (!footer) return null;
  return <AuthFooter prompt={footer.prompt} href={footer.href} action={footer.action} />;
}
