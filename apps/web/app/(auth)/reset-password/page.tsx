"use client";

import { Button } from "@repo/ui/button";
import { Form, FormErrorSummary, FormField, useZodForm } from "@repo/ui/form";
import { PasswordInput } from "@repo/ui/input";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { z } from "zod";
import { resetPassword } from "../_components/auth-actions";
import { AuthTitle } from "../_components/auth-chrome";
import { PasswordStrength } from "../_components/password-strength";

/**
 * Set a new password - the screen the emailed reset link lands on. Not in the
 * Pencil file; it reuses the Forgot Password shell.
 *
 * The stub treats the token `expired` as expired, which routes to /expired.
 */
const schema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[0-9]/, "Password must contain a number"),
    confirm: z.string().min(1, "Re-enter your password"),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type Values = z.infer<typeof schema>;

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [formError, setFormError] = useState<string | null>(null);

  const form = useZodForm(schema, {
    defaultValues: { password: "", confirm: "" },
  });

  const password = form.watch("password");

  return (
    <div className="flex flex-col gap-10">
      <AuthTitle
        title="Set a new password"
        description="Choose a password you have not used on this account before."
      />

      <Form
        form={form}
        className="gap-6"
        onSubmit={async (values) => {
          setFormError(null);
          const result = await resetPassword({ token, password: values.password });
          if (!result.ok) {
            // An expired token is not something the user can fix on this
            // screen, so send them somewhere that offers a fresh link.
            if (result.message?.includes("expired")) {
              router.push("/expired");
              return;
            }
            setFormError(result.message ?? "Could not reset your password.");
            return;
          }
          router.push("/success?of=password");
        }}
        data-testid="reset-form"
      >
        {formError ? (
          <p
            role="alert"
            className="rounded-xl bg-danger-surface p-3 text-caption-1-regular text-danger-fg"
          >
            {formError}
          </p>
        ) : null}

        <FormErrorSummary form={form} />

        <div className="flex flex-col gap-2">
          <FormField<Values, "password">
            name="password"
            render={({ field, error }) => (
              <PasswordInput
                label="New password"
                required
                hideLabel
                size="lg"
                placeholder="New password"
                autoComplete="new-password"
                error={error}
                data-testid="rp-password"
                {...field}
              />
            )}
          />
          <PasswordStrength value={password ?? ""} />
          <FormField<Values, "confirm">
            name="confirm"
            render={({ field, error }) => (
              <PasswordInput
                label="Confirm new password"
                required
                hideLabel
                size="lg"
                placeholder="Confirm new password"
                autoComplete="new-password"
                error={error}
                data-testid="rp-confirm"
                {...field}
              />
            )}
          />
        </div>

        <Button
          type="submit"
          size="xl"
          fullWidth
          loading={form.formState.isSubmitting}
          data-testid="rp-submit"
        >
          Reset password
        </Button>
      </Form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
