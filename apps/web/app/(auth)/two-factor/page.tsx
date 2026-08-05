"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import { OtpInput } from "@repo/ui/otp-input";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { verifyTwoFactor } from "../_components/auth-actions";
import { AuthTitle } from "../_components/auth-chrome";

/**
 * Two-factor - not in the Pencil file, built on the same shell.
 *
 * Carries a recovery-code fallback, because a 2FA screen with no way past a
 * lost device locks the account permanently. The two modes share one submit
 * so the pending and error handling cannot drift apart.
 *
 * The stub accepts 123456, or any recovery code of 8 or more characters.
 */
export default function TwoFactorPage() {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const value = recovery ? recoveryCode : code;
  const ready = recovery ? recoveryCode.trim().length > 0 : code.length === 6;

  const submit = async (raw: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await verifyTwoFactor({ code: raw, recovery });
      if (!result.ok) {
        setError(result.message ?? "That code is not right.");
        return;
      }
      router.push("/dashboard");
    } finally {
      setPending(false);
    }
  };

  const switchMode = () => {
    setRecovery((r) => !r);
    setError(null);
    setCode("");
    setRecoveryCode("");
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <span className="flex size-12 items-center justify-center rounded-xl bg-accent-subtle text-active-500">
          <ShieldCheck aria-hidden="true" className="size-6" strokeWidth={1.5} />
        </span>
        <AuthTitle
          title="Two step verification"
          description={
            recovery
              ? "Enter one of the recovery codes you saved when you turned on two step verification."
              : "Enter the 6 digit code from your authenticator app."
          }
        />
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
        data-testid="two-factor-form"
      >
        {recovery ? (
          <Input
            label="Recovery code"
            hideLabel
            size="lg"
            placeholder="Recovery code"
            autoComplete="one-time-code"
            startIcon={<KeyRound />}
            value={recoveryCode}
            onChange={(e) => {
              setRecoveryCode(e.target.value);
              if (error) setError(null);
            }}
            error={error}
            disabled={pending}
            data-testid="tf-recovery"
          />
        ) : (
          <OtpInput
            value={code}
            onChange={(next) => {
              setCode(next);
              if (error) setError(null);
            }}
            onComplete={(v) => void submit(v)}
            ariaLabel="Authentication code"
            error={error}
            disabled={pending}
            autoFocus
            data-testid="tf-otp"
          />
        )}

        <Button
          type="submit"
          size="xl"
          fullWidth
          loading={pending}
          disabled={!ready}
          data-testid="tf-submit"
        >
          Verify
        </Button>

        <button
          type="button"
          onClick={switchMode}
          className={cn(
            "mx-auto rounded-xl px-0.5 py-px text-subhead-semibold text-active-500",
            "transition-colors duration-150 motion-reduce:transition-none",
            "hover:text-active-600",
            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          )}
          data-testid="tf-switch"
        >
          {recovery ? "Use your authenticator app" : "Use a recovery code instead"}
        </button>
      </form>
    </div>
  );
}
