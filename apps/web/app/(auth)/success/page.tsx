"use client";

import { Button } from "@repo/ui/button";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthOutcome } from "../_components/auth-outcome";

/**
 * The shared confirmation screen. Not in the Pencil file.
 *
 * `?of=` selects the copy so one route serves every success path instead of
 * three near-identical pages drifting apart.
 */
const COPY = {
  verified: {
    title: "You are all set",
    description: "Your email is verified. Welcome to SupeHub.",
    cta: "Go to dashboard",
    href: "/dashboard",
  },
  password: {
    title: "Password changed",
    description: "Use your new password the next time you sign in.",
    cta: "Back to Sign In",
    href: "/sign-in",
  },
  account: {
    title: "Account created",
    description: "Your account is ready to use.",
    cta: "Go to dashboard",
    href: "/dashboard",
  },
} as const;

type Kind = keyof typeof COPY;

function SuccessBody() {
  const raw = useSearchParams().get("of");
  const kind: Kind = raw === "password" || raw === "account" ? raw : "verified";
  const copy = COPY[kind];

  return (
    <AuthOutcome
      tone="success"
      icon={<CircleCheck aria-hidden="true" className="size-6" strokeWidth={1.5} />}
      title={copy.title}
      description={copy.description}
    >
      <Button asChild size="xl" fullWidth data-testid="success-cta">
        <Link href={copy.href}>{copy.cta}</Link>
      </Button>
    </AuthOutcome>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessBody />
    </Suspense>
  );
}
