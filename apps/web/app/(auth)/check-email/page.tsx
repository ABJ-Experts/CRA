"use client";

import { Button } from "@repo/ui/button";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { resendCode } from "../_components/auth-actions";
import { AuthOutcome } from "../_components/auth-outcome";
import { ResendButton } from "../_components/resend-button";

/** Shown after Forgot Password. Not in the Pencil file. */
function CheckEmailBody() {
  const to = useSearchParams().get("to");

  return (
    <AuthOutcome
      icon={<MailCheck aria-hidden="true" className="size-6" strokeWidth={1.5} />}
      title="Check your email"
      // Phrased conditionally on purpose: confirming that an address is
      // registered would let anyone enumerate accounts from this screen.
      description={
        to
          ? `If ${to} has an account, we have sent it a link to reset the password.`
          : "If that address has an account, we have sent it a link to reset the password."
      }
    >
      <Button asChild size="xl" fullWidth data-testid="ce-open-mail">
        <a href="https://mail.google.com" target="_blank" rel="noreferrer noopener">
          Open Gmail
        </a>
      </Button>
      <Button asChild variant="outline" tone="grey" size="xl" fullWidth>
        <Link href="/sign-in">Back to Sign In</Link>
      </Button>
      <ResendButton onResend={resendCode} />
    </AuthOutcome>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailBody />
    </Suspense>
  );
}
