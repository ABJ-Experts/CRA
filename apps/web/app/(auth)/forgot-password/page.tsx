"use client";

import { forgotPasswordInputSchema } from "@repo/contracts/auth/schemas";
import type { ForgotPasswordInput } from "@repo/contracts/auth/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Form, FormField, useZodForm } from "@repo/ui/form";
import { Input } from "@repo/ui/input";
import { ArrowLeft, AtSign } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestPasswordReset } from "../_components/auth-actions";
import { AuthTitle } from "../_components/auth-chrome";

/**
 * Forgot Password - Pencil `qeSOO` (light) and `RM0dA` (dark).
 *
 * The only screen with no footer band, which is why its form panel is 904
 * tall rather than 832. It gains a Back control above the title instead:
 * 64x40, radius 12, `surface`, from the frame.
 */
const schema = forgotPasswordInputSchema;

type Values = ForgotPasswordInput;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const form = useZodForm(schema, { defaultValues: { email: "" } });

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Link
          href="/sign-in"
          aria-label="Go back to Sign In"
          className={cn(
            "mb-2 inline-flex size-10 w-16 items-center justify-center rounded-xl",
            "bg-surface text-fg-muted",
            "transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-surface-muted hover:text-fg",
            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          )}
          data-testid="fp-back"
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </Link>
        <AuthTitle
          title="Reset Password"
          description="The new password will send to your email."
        />
      </div>

      <Form
        form={form}
        className="gap-6"
        onSubmit={async (values) => {
          await requestPasswordReset(values);
          // Always the same destination: revealing whether an address exists
          // would leak which accounts are registered.
          router.push(`/check-email?to=${encodeURIComponent(values.email)}`);
        }}
        data-testid="forgot-form"
      >
        <FormField<Values, "email">
          name="email"
          render={({ field, error }) => (
            <Input
              label="Email"
              required
              hideLabel
              size="lg"
              type="email"
              placeholder="Email"
              autoComplete="email"
              startIcon={<AtSign />}
              error={error}
              data-testid="fp-email"
              {...field}
            />
          )}
        />

        <Button
          type="submit"
          size="xl"
          fullWidth
          loading={form.formState.isSubmitting}
          data-testid="fp-submit"
        >
          Send
        </Button>
      </Form>
    </div>
  );
}
