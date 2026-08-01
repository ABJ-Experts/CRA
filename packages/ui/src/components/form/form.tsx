"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  FormProvider,
  useFormContext,
  useForm as useReactHookForm,
  type ControllerRenderProps,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type SubmitHandler,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { ComponentProps, ReactNode } from "react";
import type { z } from "zod";
import { cn } from "../../lib/cn";

/**
 * Typed form helpers built on React Hook Form + Zod.
 *
 * The schema is the single source of truth: field names, value types and
 * validation all come from it, so `useZodForm` needs no separate generic and
 * `FormField` autocompletes `name` against the schema's keys.
 *
 * ```tsx
 * const schema = z.object({ email: z.email(), plan: z.enum(["free", "pro"]) });
 *
 * const form = useZodForm(schema, { defaultValues: { email: "", plan: "free" } });
 *
 * <Form form={form} onSubmit={(values) => save(values)}>
 *   <FormField name="email" render={({ field, error }) => (
 *     <Input label="Email" required error={error} {...field} />
 *   )} />
 *   <Button type="submit">Save</Button>
 * </Form>
 * ```
 */

/**
 * `useForm` with the Zod resolver already wired and the value type inferred
 * from the schema. Validates on submit, then re-validates on change so errors
 * clear as the user fixes them rather than only on the next submit.
 */
export function useZodForm<TSchema extends z.ZodType<FieldValues>>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.infer<TSchema>>, "resolver"> & {
    defaultValues?: DefaultValues<z.infer<TSchema>>;
  }
): UseFormReturn<z.infer<TSchema>> {
  return useReactHookForm<z.infer<TSchema>>({
    resolver: zodResolver(schema as never),
    mode: "onSubmit",
    reValidateMode: "onChange",
    ...options,
  });
}

export interface FormProps<TValues extends FieldValues>
  extends Omit<ComponentProps<"form">, "onSubmit"> {
  form: UseFormReturn<TValues>;
  /** Called with parsed, type-safe values only when validation passes. */
  onSubmit: SubmitHandler<TValues>;
}

/**
 * Wraps `<form>` with RHF context so `FormField` works without prop drilling.
 * `noValidate` is set so our own messages show instead of the browser's.
 */
export function Form<TValues extends FieldValues>({
  form,
  onSubmit,
  className,
  children,
  ...props
}: FormProps<TValues>) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn("flex flex-col gap-5", className)}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

export interface FormFieldRenderArgs<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> {
  /** Spread onto any of our controls: value, onChange, onBlur, name, ref. */
  field: ControllerRenderProps<TValues, TName>;
  /** Message for this field, or undefined when valid. */
  error: string | undefined;
  /** True once the user has interacted with the field. */
  isTouched: boolean;
  /** True while the form is submitting, for disabling controls. */
  isSubmitting: boolean;
}

export interface FormFieldProps<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> {
  name: TName;
  render: (args: FormFieldRenderArgs<TValues, TName>) => ReactNode;
}

/**
 * Binds one schema field to a control.
 *
 * Uses `Controller` rather than `register` because every control in this
 * library is a controlled component (Radix Select, Checkbox, Switch and the
 * Combobox all report changes through callbacks, not DOM events).
 *
 * The error string is passed straight to the control's `error` prop, which
 * already handles `aria-invalid`, `aria-errormessage` and the danger styling.
 */
export function FormField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({ name, render }: FormFieldProps<TValues, TName>) {
  const form = useFormContext<TValues>();

  if (!form) {
    throw new Error("<FormField> must be rendered inside <Form>.");
  }

  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState, formState }) =>
        render({
          field,
          error: fieldState.error?.message,
          isTouched: fieldState.isTouched,
          isSubmitting: formState.isSubmitting,
        }) as React.ReactElement
      }
    />
  );
}

/** Summary of all current errors, useful above a long form. */
export function FormErrorSummary<TValues extends FieldValues>({
  form,
  title = "Please fix the following",
  className,
}: {
  form: UseFormReturn<TValues>;
  title?: string;
  className?: string;
}) {
  const errors = Object.entries(form.formState.errors);
  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      // Focusable so submit handlers can move focus here for screen readers.
      tabIndex={-1}
      className={cn(
        "flex flex-col gap-1 rounded-xl bg-danger-surface p-3",
        "text-caption-1-regular text-danger-fg",
        className
      )}
    >
      <p className="text-caption-1-semibold">{title}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4">
        {errors.map(([name, err]) => (
          <li key={name}>{String((err as { message?: string })?.message ?? name)}</li>
        ))}
      </ul>
    </div>
  );
}

export { useFormContext, type UseFormReturn, type SubmitHandler };
