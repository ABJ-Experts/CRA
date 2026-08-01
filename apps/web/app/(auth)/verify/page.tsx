"use client";

import { Button } from "@repo/ui/button";
import { OtpInput } from "@repo/ui/otp-input";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { resendCode, verifyCode } from "../_components/auth-actions";
import { AuthTitle } from "../_components/auth-chrome";
import { ResendButton } from "../_components/resend-button";

/**
 * Verify email - not in the Pencil file. Built on the same shell so it sits
 * with the designed screens; the code field is the new `OtpInput`, styled
 * from the 48px auth field.
 *
 * The stub accepts 123456.
 */
function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const to = params.get("to");

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (value: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await verifyCode({ code: value });
      if (!result.ok) {
        setError(result.message ?? "That code is not right.");
        return;
      }
      router.push("/success?of=verified");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <AuthTitle
        title="Check your inbox"
        description={
          to
            ? `Enter the 6 digit code we sent to ${to}`
            : "Enter the 6 digit code we sent you"
        }
      />

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
        data-testid="verify-form"
      >
        <OtpInput
          value={code}
          onChange={(next) => {
            setCode(next);
            if (error) setError(null);
          }}
          // Auto-submit on the sixth digit: the user has nothing left to add,
          // and making them reach for a button after typing a code is friction.
          onComplete={(value) => void submit(value)}
          ariaLabel="Verification code"
          error={error}
          disabled={pending}
          autoFocus
          data-testid="verify-otp"
        />

        <Button
          type="submit"
          size="xl"
          fullWidth
          loading={pending}
          disabled={code.length < 6}
          data-testid="verify-submit"
        >
          Verify
        </Button>

        <ResendButton onResend={resendCode} />
      </form>
    </div>
  );
}

export default function VerifyPage() {
  // `useSearchParams` needs a Suspense boundary or the whole route opts out
  // of static rendering.
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}
