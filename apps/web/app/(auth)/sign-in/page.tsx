"use client";

import { signInInputSchema } from "@repo/contracts/auth/schemas";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Form, FormErrorSummary, FormField, useZodForm } from "@repo/ui/form";
import { Input, PasswordInput } from "@repo/ui/input";
import { AtSign } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { signIn } from "../_components/auth-actions";
import { AuthDivider, AuthTitle } from "../_components/auth-chrome";
import { SocialButtons } from "../_components/social-buttons";

/**
 * Sign in - Pencil `a1za5` (light) and `IBYQC` (dark).
 *
 * The frame's subtitle reads "Please, sign in to countinue". Corrected here:
 * a visible spelling mistake is a defect, not a design decision.
 */
const schema = z.object({
  identifier: signInInputSchema.shape.email,
  password: signInInputSchema.shape.password,
  remember: signInInputSchema.shape.remember,
});

type Values = z.output<typeof schema>;

export default function SignInPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useZodForm(schema, {
    defaultValues: { identifier: "", password: "", remember: true },
  });

  return (
    <div className="flex flex-col gap-10">
      <AuthTitle
        title="Welcome Back"
        description="Please, sign in to continue"
      />

      <Form
        form={form}
        method="post"
        className="gap-6"
        onSubmit={async (values) => {
          setFormError(null);
          const result = await signIn(values);
          if (!result.ok) {
            setFormError(result.message ?? "Could not sign you in.");
            return;
          }
          router.push(
            result.next === "two-factor" ? "/two-factor" : "/dashboard",
          );
        }}
        data-testid="sign-in-form"
      >
        {formError ? (
          <p
            role="alert"
            className="rounded-xl bg-danger-surface p-3 text-caption-1-regular text-danger-fg"
            data-testid="sign-in-error"
          >
            {formError}
          </p>
        ) : null}

        <FormErrorSummary form={form} />

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <FormField<Values, "identifier">
              name="identifier"
              render={({ field, error }) => (
                <Input
                  label="Email or User Name"
                  required
                  size="lg"
                  hideLabel
                  placeholder="Email or User Name"
                  autoComplete="username"
                  startIcon={<AtSign />}
                  error={error}
                  data-testid="si-identifier"
                  {...field}
                />
              )}
            />

            <FormField<Values, "password">
              name="password"
              render={({ field, error }) => (
                <PasswordInput
                  label="Password"
                  required
                  size="lg"
                  hideLabel
                  placeholder="Password"
                  autoComplete="current-password"
                  error={error}
                  data-testid="si-password"
                  {...field}
                />
              )}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <FormField<Values, "remember">
              name="remember"
              render={({ field }) => (
                <Checkbox
                  label="Remember me"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="si-remember"
                />
              )}
            />
            <Link
              href="/forgot-password"
              className="shrink-0 rounded-xl px-0.5 py-px text-caption-1-semibold text-active-500 outline-none hover:text-active-600 focus-visible:ring-2 focus-visible:ring-active-500"
            >
              Forgot Password?
            </Link>
          </div>
        </div>

        <Button
          type="submit"
          size="xl"
          fullWidth
          loading={form.formState.isSubmitting}
          data-testid="si-submit"
        >
          Sign In
        </Button>

        <AuthDivider>or sign in with</AuthDivider>

        <SocialButtons
          action="Sign In"
          disabled={form.formState.isSubmitting}
        />
      </Form>
    </div>
  );
}
