"use client";

import { Button } from "@repo/ui/button";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "../../(auth)/_components/auth-actions";

/**
 * Top bar for the product shell: brand, then the sign-out control.
 *
 * Sign-out goes through /api/auth/sign-out rather than clearing anything here —
 * the session is an httpOnly cookie, so client JavaScript cannot clear it even
 * if it wanted to. The route handler also revokes the GoTrue session, so the
 * refresh token dies server-side instead of merely being forgotten.
 */
export function AppTopBar() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    const result = await signOut();
    router.push(result.next ?? "/sign-in");
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-canvas px-6 lg:px-[30px]">
      <span className="text-subhead-semibold text-fg">CRA Sentinel</span>

      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleSignOut()}
        disabled={busy}
      >
        <LogOut className="size-4" aria-hidden />
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </header>
  );
}
