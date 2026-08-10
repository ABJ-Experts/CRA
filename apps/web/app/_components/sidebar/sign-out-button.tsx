"use client";

import { cn } from "@repo/ui/cn";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sessionApi } from "../../_features/session/session.api";

export function SignOutButton({ collapsed }: { readonly collapsed: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setIsSigningOut(true);
    setError(null);

    try {
      await sessionApi.signOut();
      queryClient.clear();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("We couldn't sign you out. Try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", collapsed && "items-center")}>
      <button
        type="button"
        onClick={signOut}
        disabled={isSigningOut}
        aria-busy={isSigningOut || undefined}
        aria-label={isSigningOut ? "Signing out" : "Sign out"}
        title={collapsed ? "Sign out" : undefined}
        className={cn(
          "flex h-10 items-center rounded-xl text-subhead-medium",
          "text-fg-muted transition-colors duration-150 motion-reduce:transition-none",
          "hover:bg-surface hover:text-fg disabled:cursor-wait disabled:opacity-60",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          collapsed ? "size-10 justify-center px-0" : "w-full gap-2 px-3",
        )}
      >
        <LogOut aria-hidden="true" className="size-4 shrink-0" />
        {!collapsed ? (
          <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
        ) : null}
      </button>
      {error && !collapsed ? (
        <p role="status" className="text-caption-2-regular text-brink-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
