"use client";

import { Button } from "@repo/ui/button";
import { Form, FormErrorSummary, FormField, useZodForm } from "@repo/ui/form";
import { Input, PasswordInput } from "@repo/ui/input";
import { AtSign, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { signUp } from "../_components/auth-actions";
import { AuthDivider, AuthTitle } from "../_components/auth-chrome";
import { SocialButtons } from "../_components/social-buttons";

/** Sign up - Pencil `E06tAN` (light) and `ZPXtp` (dark). */
const schema = z
  .object({
    email: z.email({ message: "Enter a valid email address" }),
    username: z
      .string()
      .min(3, "User name must be at least 3 characters")
      .max(32, "User name must be 32 characters or fewer")
      .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dot, dash and underscore only"),
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

export default function SignUpPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useZodForm(schema, {
    defaultValues: { email: "", username: "", password: "", confirm: "" },
  });

  return (
    <div className="flex flex-col gap-10">
      <AuthTitle
        title="Join With Us"
        description="Create the account to join CRA"
      />

      <Form
        form={form}
        className="gap-6"
        onSubmit={async (values) => {
          setFormError(null);
          const result = await signUp(values);
          if (!result.ok) {
            if (result.fieldErrors) {
              for (const [name, message] of Object.entries(result.fieldErrors)) {
                form.setError(name as keyof Values, { message });
              }
            }
            if (result.message) setFormError(result.message);
            return;
          }
          router.push("/verify");
        }}
        data-testid="sign-up-form"
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
                data-testid="su-email"
                {...field}
              />
            )}
          />
          <FormField<Values, "username">
            name="username"
            render={({ field, error }) => (
              <Input
                label="User Name"
                required
                hideLabel
                size="lg"
                placeholder="User Name"
                autoComplete="username"
                startIcon={<User />}
                error={error}
                data-testid="su-username"
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
                hideLabel
                size="lg"
                placeholder="Password"
                autoComplete="new-password"
                error={error}
                data-testid="su-password"
                {...field}
              />
            )}
          />
          <FormField<Values, "confirm">
            name="confirm"
            render={({ field, error }) => (
              <PasswordInput
                label="Re-enter Password"
                required
                hideLabel
                size="lg"
                placeholder="Re-enter Password"
                autoComplete="new-password"
                error={error}
                data-testid="su-confirm"
                {...field}
              />
            )}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            size="xl"
            fullWidth
            loading={form.formState.isSubmitting}
            data-testid="su-submit"
          >
            Sign Up
          </Button>
          <p className="text-caption-2-regular text-fg-muted">
            By click Sign Up, you agree to our{" "}
            <Link
              href="/terms"
              className="text-active-500 underline underline-offset-2"
            >
              Terms of Use
            </Link>{" "}
            and that you have read our{" "}
            <Link
              href="/privacy"
              className="text-active-500 underline underline-offset-2"
            >
              Privacy Policy
            </Link>
          </p>
        </div>

        <AuthDivider>or sign Up with</AuthDivider>

        <SocialButtons action="Sign Up" disabled={form.formState.isSubmitting} />
      </Form>
    </div>
  );
}
