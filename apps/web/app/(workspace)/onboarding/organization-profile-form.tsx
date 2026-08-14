"use client";

import {
  ISO_3166_ALPHA_2_CODES,
  createOrganizationInputSchema,
  e164PhoneSchema,
  type CreateOrganizationInput,
  type Organization,
  type UpdateLegalProfileInput,
  updateLegalProfileInputSchema,
} from "@repo/contracts";
import { Button } from "@repo/ui/button";
import {
  Form,
  FormErrorSummary,
  FormField,
  type UseFormReturn,
  useZodForm,
} from "@repo/ui/form";
import { Input } from "@repo/ui/input";
import { Select, SelectItem } from "@repo/ui/select";
import { useState } from "react";
import { z } from "zod";

import { ApiClientError } from "../../_lib/http/api-client";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_OPTIONS = ISO_3166_ALPHA_2_CODES.map(
  (value) => [value, countryNames.of(value) ?? value] as const,
);

const organizationInput = createOrganizationInputSchema.shape;
const addressInput = organizationInput.registeredAddress.shape;
const countrySelectionSchema = z
  .string()
  .refine((value) => addressInput.country.safeParse(value).success, {
    message: "Select a country",
  });

/* Empty optional controls are normalized only at the request boundary. */
const legalProfileFormSchema = z.object({
  legalName: organizationInput.legalName,
  registeredAddress: z.object({
    addressLine1: addressInput.addressLine1,
    addressLine2: z.string().trim().max(200),
    locality: addressInput.locality,
    administrativeArea: z.string().trim().max(120),
    postalCode: addressInput.postalCode,
    country: countrySelectionSchema,
  }),
  mainEstablishmentCountry: countrySelectionSchema,
  phone: z.union([z.literal(""), e164PhoneSchema]),
  manufacturerContactName: organizationInput.manufacturerContactName,
  manufacturerContactEmail: organizationInput.manufacturerContactEmail,
});

type LegalProfileFormValues = z.input<typeof legalProfileFormSchema>;
type LegalProfile = NonNullable<Organization["legalProfile"]>;
type LegalProfileFieldName =
  | "legalName"
  | "registeredAddress.addressLine1"
  | "registeredAddress.addressLine2"
  | "registeredAddress.locality"
  | "registeredAddress.administrativeArea"
  | "registeredAddress.postalCode"
  | "registeredAddress.country"
  | "mainEstablishmentCountry"
  | "phone"
  | "manufacturerContactName"
  | "manufacturerContactEmail";

const legalProfileFieldNames = new Set<LegalProfileFieldName>([
  "legalName",
  "registeredAddress.addressLine1",
  "registeredAddress.addressLine2",
  "registeredAddress.locality",
  "registeredAddress.administrativeArea",
  "registeredAddress.postalCode",
  "registeredAddress.country",
  "mainEstablishmentCountry",
  "phone",
  "manufacturerContactName",
  "manufacturerContactEmail",
]);

type OrganizationProfileFormProps =
  | Readonly<{
      mode: "create";
      onCreate: (input: CreateOrganizationInput) => Promise<unknown>;
      isCreating: boolean;
    }>
  | Readonly<{
      mode: "edit";
      profile: LegalProfile | null;
      onUpdate: (input: UpdateLegalProfileInput) => Promise<unknown>;
      isUpdating: boolean;
      onCancel: () => void;
    }>;

function optionalValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toProfileInput(values: LegalProfileFormValues) {
  return {
    ...values,
    registeredAddress: {
      ...values.registeredAddress,
      addressLine2: optionalValue(values.registeredAddress.addressLine2),
      administrativeArea: optionalValue(
        values.registeredAddress.administrativeArea,
      ),
    },
    phone: optionalValue(values.phone),
  };
}

function toCreateInput(
  values: LegalProfileFormValues,
  idempotencyKey: string,
): CreateOrganizationInput {
  return createOrganizationInputSchema.parse({
    ...toProfileInput(values),
    idempotencyKey,
  });
}

function toUpdateInput(
  values: LegalProfileFormValues,
  expectedVersion: number,
): UpdateLegalProfileInput {
  return updateLegalProfileInputSchema.parse({
    ...toProfileInput(values),
    expectedVersion,
  });
}

function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

function createErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.kind === "api") {
    return error.message;
  }
  if (error instanceof ApiClientError && error.kind === "network") {
    return "We could not reach the server. Your details are still in the form.";
  }
  return "We could not create the organization. Your details are still in the form.";
}

function applyServerFieldErrors(
  form: UseFormReturn<LegalProfileFormValues>,
  error: unknown,
): void {
  if (!(error instanceof ApiClientError) || error.kind !== "api") return;

  for (const [name, message] of Object.entries(error.fieldErrors ?? {})) {
    if (legalProfileFieldNames.has(name as LegalProfileFieldName)) {
      form.setError(name as LegalProfileFieldName, { message });
    }
  }
}

export function OrganizationProfileForm({
  ...props
}: OrganizationProfileFormProps) {
  const profile = props.mode === "edit" ? props.profile : null;
  const form = useZodForm(legalProfileFormSchema, {
    defaultValues: {
      legalName: profile?.legalName ?? "",
      registeredAddress: {
        addressLine1: profile?.registeredAddress.addressLine1 ?? "",
        addressLine2: profile?.registeredAddress.addressLine2 ?? "",
        locality: profile?.registeredAddress.locality ?? "",
        administrativeArea: profile?.registeredAddress.administrativeArea ?? "",
        postalCode: profile?.registeredAddress.postalCode ?? "",
        country: profile?.registeredAddress.country ?? "",
      },
      mainEstablishmentCountry: profile?.mainEstablishmentCountry ?? "",
      phone: profile?.phone ?? "",
      manufacturerContactName: profile?.manufacturerContactName ?? "",
      manufacturerContactEmail: profile?.manufacturerContactEmail ?? "",
    },
  });
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"idle" | "success" | "error">("idle");

  async function submit(values: LegalProfileFormValues) {
    setMessage(null);
    setOutcome("idle");

    try {
      if (props.mode === "create") {
        const requestKey = idempotencyKey ?? createIdempotencyKey();
        if (idempotencyKey === null) setIdempotencyKey(requestKey);
        await props.onCreate(toCreateInput(values, requestKey));
      } else {
        await props.onUpdate(
          toUpdateInput(values, props.profile?.version ?? 0),
        );
      }
      setOutcome("success");
      setMessage(
        props.mode === "create"
          ? "Organization created. Loading your server-confirmed onboarding progress…"
          : "Legal organization profile updated.",
      );
    } catch (error) {
      applyServerFieldErrors(form, error);
      setOutcome("error");
      setMessage(createErrorMessage(error));
    }
  }

  return (
    <Form form={form} onSubmit={submit} className="gap-6">
      <FormErrorSummary form={form} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField<LegalProfileFormValues, "legalName">
          name="legalName"
          render={({ field, error }) => (
            <Input
              {...field}
              label="Legal organization name"
              required
              autoComplete="organization"
              error={error}
            />
          )}
        />
        <FormField<LegalProfileFormValues, "mainEstablishmentCountry">
          name="mainEstablishmentCountry"
          render={({ field, error }) => (
            <Select
              label="Main establishment country"
              required
              placeholder="Select a country"
              value={field.value}
              onValueChange={field.onChange}
              error={error}
            >
              {COUNTRY_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </Select>
          )}
        />
      </div>

      <fieldset className="grid gap-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-subhead-semibold text-fg">
          Registered address
        </legend>
        <FormField<LegalProfileFormValues, "registeredAddress.addressLine1">
          name="registeredAddress.addressLine1"
          render={({ field, error }) => (
            <Input
              {...field}
              label="Registered address line 1"
              required
              autoComplete="address-line1"
              error={error}
            />
          )}
        />
        <FormField<LegalProfileFormValues, "registeredAddress.addressLine2">
          name="registeredAddress.addressLine2"
          render={({ field, error }) => (
            <Input
              {...field}
              label="Registered address line 2"
              autoComplete="address-line2"
              error={error}
            />
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField<LegalProfileFormValues, "registeredAddress.locality">
            name="registeredAddress.locality"
            render={({ field, error }) => (
              <Input
                {...field}
                label="City or locality"
                required
                autoComplete="address-level2"
                error={error}
              />
            )}
          />
          <FormField<
            LegalProfileFormValues,
            "registeredAddress.administrativeArea"
          >
            name="registeredAddress.administrativeArea"
            render={({ field, error }) => (
              <Input
                {...field}
                label="State, province, or region"
                autoComplete="address-level1"
                error={error}
              />
            )}
          />
          <FormField<LegalProfileFormValues, "registeredAddress.postalCode">
            name="registeredAddress.postalCode"
            render={({ field, error }) => (
              <Input
                {...field}
                label="Postal code"
                required
                autoComplete="postal-code"
                error={error}
              />
            )}
          />
          <FormField<LegalProfileFormValues, "registeredAddress.country">
            name="registeredAddress.country"
            render={({ field, error }) => (
              <Select
                label="Registered address country"
                required
                placeholder="Select a country"
                value={field.value}
                onValueChange={field.onChange}
                error={error}
              >
                {COUNTRY_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            )}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField<LegalProfileFormValues, "manufacturerContactName">
          name="manufacturerContactName"
          render={({ field, error }) => (
            <Input
              {...field}
              label="Manufacturer contact name"
              required
              autoComplete="name"
              error={error}
            />
          )}
        />
        <FormField<LegalProfileFormValues, "manufacturerContactEmail">
          name="manufacturerContactEmail"
          render={({ field, error }) => (
            <Input
              {...field}
              label="Manufacturer contact email"
              required
              type="email"
              autoComplete="email"
              error={error}
            />
          )}
        />
      </div>

      <FormField<LegalProfileFormValues, "phone">
        name="phone"
        render={({ field, error }) => (
          <Input
            {...field}
            label="Phone number"
            helperText="Optional. Use international format, for example +442079460000."
            autoComplete="tel"
            error={error}
          />
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={
            (props.mode === "create" ? props.isCreating : props.isUpdating) ||
            form.formState.isSubmitting
          }
        >
          {props.mode === "create"
            ? "Create organization"
            : "Save legal profile"}
        </Button>
        {props.mode === "edit" ? (
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={props.onCancel}
            disabled={props.isUpdating || form.formState.isSubmitting}
          >
            Cancel
          </Button>
        ) : null}
        {message ? (
          <p
            role="status"
            className={
              outcome === "error"
                ? "text-caption-1-regular text-danger"
                : "text-caption-1-regular text-fg-muted"
            }
          >
            {message}
          </p>
        ) : null}
      </div>
    </Form>
  );
}
