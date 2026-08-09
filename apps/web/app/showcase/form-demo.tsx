"use client";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Combobox, type ComboboxOption } from "@repo/ui/combobox";
import { Form, FormErrorSummary, FormField, useZodForm } from "@repo/ui/form";
import { Input } from "@repo/ui/input";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Select, SelectItem } from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Lock, Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

const COUNTRIES: ComboboxOption[] = [
  { value: "gb", label: "United Kingdom", keywords: ["uk"] },
  { value: "de", label: "Germany" },
  { value: "us", label: "United States", keywords: ["usa", "america"] },
  { value: "in", label: "India" },
  { value: "jp", label: "Japan" },
];

/**
 * The schema is the single source of truth. Field names, value types and every
 * message below come from here; nothing is duplicated in the components.
 */
const schema = z
  .object({
    email: z.email({ message: "Enter a valid email address" }),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[0-9]/, "Password must contain a number"),
    confirm: z.string(),
    country: z.string().min(1, "Select a country"),
    plan: z.enum(["free", "pro", "enterprise"]),
    role: z.enum(["engineer", "designer", "other"], {
      message: "Choose a role",
    }),
    notifications: z.boolean(),
    terms: z.literal(true, { message: "You must accept the terms" }),
  })
  // Cross-field rule: the error is attached to `confirm` so it renders on
  // that control rather than at the form level.
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type Values = z.infer<typeof schema>;

export function FormDemo() {
  const [submitted, setSubmitted] = useState<Values | null>(null);

  const form = useZodForm(schema, {
    defaultValues: {
      email: "",
      password: "",
      confirm: "",
      country: "",
      plan: "free",
      notifications: true,
    },
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <Form
        form={form}
        onSubmit={async (values) => {
          // Stand-in for a request, so the submitting state is observable.
          await new Promise((r) => setTimeout(r, 600));
          setSubmitted(values);
        }}
        className="max-w-md"
        data-testid="demo-form"
      >
        <FormErrorSummary form={form} />

        <FormField<Values, "email">
          name="email"
          render={({ field, error }) => (
            <Input
              label="Email"
              required
              type="email"
              placeholder="you@example.com"
              startIcon={<Mail />}
              error={error}
              data-testid="f-email"
              {...field}
            />
          )}
        />

        <FormField<Values, "password">
          name="password"
          render={({ field, error }) => (
            <Input
              label="Password"
              required
              type="password"
              placeholder="At least 8 characters"
              startIcon={<Lock />}
              error={error}
              data-testid="f-password"
              {...field}
            />
          )}
        />

        <FormField<Values, "confirm">
          name="confirm"
          render={({ field, error }) => (
            <Input
              label="Confirm password"
              required
              type="password"
              startIcon={<Lock />}
              error={error}
              data-testid="f-confirm"
              {...field}
            />
          )}
        />

        <FormField<Values, "country">
          name="country"
          render={({ field, error }) => (
            <Combobox
              label="Country"
              required
              options={COUNTRIES}
              searchPlaceholder="Search countries"
              error={error}
              value={field.value}
              onValueChange={field.onChange}
              data-testid="f-country"
            />
          )}
        />

        <FormField<Values, "plan">
          name="plan"
          render={({ field, error }) => (
            <Select
              label="Plan"
              required
              error={error}
              value={field.value}
              onValueChange={field.onChange}
              data-testid="f-plan"
            >
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </Select>
          )}
        />

        <FormField<Values, "role">
          name="role"
          render={({ field, error }) => (
            <RadioGroup
              label="Role"
              error={error}
              value={field.value}
              onValueChange={field.onChange}
            >
              <Radio value="engineer" label="Engineer" />
              <Radio value="designer" label="Designer" />
              <Radio value="other" label="Other" />
            </RadioGroup>
          )}
        />

        <FormField<Values, "notifications">
          name="notifications"
          render={({ field }) => (
            <Switch
              label="Email notifications"
              checked={field.value}
              onCheckedChange={field.onChange}
              data-testid="f-notifications"
            />
          )}
        />

        <FormField<Values, "terms">
          name="terms"
          render={({ field, error }) => (
            <Checkbox
              label="I accept the"
              link="Terms of Service"
              error={error}
              checked={field.value === true}
              onCheckedChange={field.onChange}
              data-testid="f-terms"
            />
          )}
        />

        <div className="flex gap-3">
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            data-testid="f-submit"
          >
            Create account
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => {
              form.reset();
              setSubmitted(null);
            }}
          >
            Reset
          </Button>
        </div>
      </Form>

      <aside className="flex flex-col gap-2">
        <span className="text-caption-1-semibold text-fg-muted">
          Parsed output
        </span>
        <pre
          data-testid="f-output"
          className="overflow-x-auto rounded-xl bg-surface p-3 text-caption-2-regular text-fg"
        >
          {submitted
            ? JSON.stringify(submitted, null, 2)
            : "Submit to see typed values"}
        </pre>
      </aside>
    </div>
  );
}
