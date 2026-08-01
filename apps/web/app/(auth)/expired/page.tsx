"use client";

import { Button } from "@repo/ui/button";
import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { AuthOutcome } from "../_components/auth-outcome";

/**
 * Invalid or expired link. Not in the Pencil file.
 *
 * Reset links are single use and time limited, so this is a state real users
 * hit routinely - by opening yesterday's email, or by following a link the
 * mail client already prefetched and consumed. It exists so that lands
 * somewhere with a way forward rather than on a dead form.
 */
export default function ExpiredPage() {
  return (
    <AuthOutcome
      tone="warning"
      icon={<LinkIcon aria-hidden="true" className="size-6" strokeWidth={1.5} />}
      title="This link has expired"
      description="Reset links last one hour and can only be used once. Request a new one and we will email it straight away."
    >
      <Button asChild size="xl" fullWidth data-testid="expired-retry">
        <Link href="/forgot-password">Request a new link</Link>
      </Button>
      <Button asChild variant="outline" tone="grey" size="xl" fullWidth>
        <Link href="/sign-in">Back to Sign In</Link>
      </Button>
    </AuthOutcome>
  );
}
