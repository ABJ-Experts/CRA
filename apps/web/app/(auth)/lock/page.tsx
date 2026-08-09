"use client";

import { Avatar } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Form, FormField, useZodForm } from "@repo/ui/form";
import { PasswordInput } from "@repo/ui/input";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { lockedSession, unlock } from "../_components/auth-actions";

/**
 * Lock Screen - Pencil `ZAzq6` (light) and `Wo7JP` (dark).
 *
 * Profile block from the frame: 100px avatar, name 28/500 -> `text-h4`,
 * email 14/400 -> `subhead-regular` + `fg-muted`, gap 16 above a 24-gap form.
 * The trailing "Sign in with another accounts" is a 40-tall ghost button.
 */
const schema = z.object({
  password: z.string().min(1, "Enter your password"),
});

type Values = z.infer<typeof schema>;

export default function LockPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(schema, { defaultValues: { password: "" } });

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col items-center gap-4">
        <Avatar
          name={lockedSession.name}
          className="size-25"
          data-testid="lock-avatar"
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-h4 text-fg">{lockedSession.name}</h1>
          <p className="text-subhead-regular text-fg-muted">
            {lockedSession.email}
          </p>
        </div>
      </div>

      <Form
        form={form}
        className="gap-6"
        onSubmit={async (values) => {
          setFormError(null);
          const result = await unlock(values);
          if (!result.ok) {
            setFormError(result.message ?? "Could not unlock.");
            return;
          }
          router.push("/dashboard");
        }}
        data-testid="lock-form"
      >
        {formError ? (
          <p
            role="alert"
            className="rounded-xl bg-danger-surface p-3 text-caption-1-regular text-danger-fg"
            data-testid="lock-error"
          >
            {formError}
          </p>
        ) : null}

        <FormField<Values, "password">
          name="password"
          render={({ field, error }) => (
            <PasswordInput
              label="Password"
              required
              hideLabel
              size="lg"
              placeholder="Password"
              autoComplete="current-password"
              error={error}
              data-testid="lock-password"
              {...field}
            />
          )}
        />

        <Button
          type="submit"
          size="xl"
          fullWidth
          loading={form.formState.isSubmitting}
          data-testid="lock-submit"
        >
          Unlock
        </Button>

        <Link
          href="/sign-in"
          className={cn(
            "flex h-10 w-full items-center justify-center gap-2 rounded-xl",
            "px-4 pt-[10px] pb-[9px]",
            "text-subhead-semibold text-fg-muted",
            "transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-surface hover:text-fg",
            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          )}
          data-testid="lock-other"
        >
          <LogIn aria-hidden="true" className="size-4" strokeWidth={1.5} />
          Sign in with another accounts
        </Link>
      </Form>
    </div>
  );
}
