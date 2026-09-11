"use client";

import { createInvitationInputSchema } from "@repo/contracts/invitations/schemas";
import type { CreateInvitationInput } from "@repo/contracts/invitations/types";
import { BASE_ROLES } from "@repo/contracts/permissions";
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

import {
  useCreateInvitationMutation,
  useInvitationListQuery,
  useResendInvitationMutation,
  useRevokeInvitationMutation,
} from "../../_features/invitations/invitations.queries";
import { ApiClientError } from "../../_lib/http/api-client";

type InvitationFormValues = CreateInvitationInput;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError && error.kind === "api"
    ? error.message
    : fallback;
}

function applyInvitationFieldErrors(
  form: UseFormReturn<InvitationFormValues>,
  error: unknown,
): void {
  if (!(error instanceof ApiClientError) || error.kind !== "api") return;
  const email = error.fieldErrors?.email;
  if (email) form.setError("email", { message: email });
  const role = error.fieldErrors?.role;
  if (role) form.setError("role", { message: role });
}

export function InvitationManager({
  canView,
  canCreate,
  canDelete,
}: {
  canView: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const list = useInvitationListQuery(canView);
  const create = useCreateInvitationMutation();
  const resend = useResendInvitationMutation();
  const revoke = useRevokeInvitationMutation();
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const form = useZodForm(createInvitationInputSchema, {
    defaultValues: { email: "", role: "member" },
  });

  async function submit(values: InvitationFormValues) {
    setMessage(null);
    try {
      await create.mutateAsync(values);
      form.reset({ email: "", role: "member" });
      setMessage("Invitation sent and delivery confirmed.");
    } catch (error) {
      applyInvitationFieldErrors(form, error);
      setMessage(errorMessage(error, "We could not send that invitation."));
    }
  }

  async function resendInvitation(invitationId: string) {
    setBusyId(invitationId);
    setMessage(null);
    try {
      await resend.mutateAsync(invitationId);
      setMessage("Invitation resent and delivery confirmed.");
    } catch (error) {
      setMessage(errorMessage(error, "We could not resend that invitation."));
    } finally {
      setBusyId(null);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setBusyId(invitationId);
    setMessage(null);
    try {
      await revoke.mutateAsync(invitationId);
      setMessage("Invitation revoked.");
    } catch (error) {
      setMessage(errorMessage(error, "We could not revoke that invitation."));
    } finally {
      setBusyId(null);
    }
  }

  if (!canView) {
    return (
      <p className="text-subhead-regular text-fg-muted">
        You do not have access to the organization’s invitations.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="invite-team-heading"
      className="flex flex-col gap-4"
    >
      <div>
        <h3 id="invite-team-heading" className="text-subhead-semibold text-fg">
          Invite the team
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          A team invitation counts toward onboarding only after email delivery
          is confirmed by the server.
        </p>
      </div>

      {canCreate ? (
        <Form form={form} onSubmit={submit} className="gap-4">
          <FormErrorSummary form={form} />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
            <FormField<InvitationFormValues, "email">
              name="email"
              render={({ field, error }) => (
                <Input
                  {...field}
                  label="Team member email"
                  type="email"
                  autoComplete="email"
                  required
                  error={error}
                />
              )}
            />
            <FormField<InvitationFormValues, "role">
              name="role"
              render={({ field, error }) => (
                <Select
                  label="Role"
                  value={field.value}
                  onValueChange={field.onChange}
                  error={error}
                >
                  {BASE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </SelectItem>
                  ))}
                </Select>
              )}
            />
            <div className="flex items-end">
              <Button
                type="submit"
                loading={create.isPending || form.formState.isSubmitting}
              >
                Send invite
              </Button>
            </div>
          </div>
        </Form>
      ) : (
        <p className="text-caption-1-regular text-fg-muted">
          You can view invitations, but cannot send one with your current role.
        </p>
      )}

      {message ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          {message}
        </p>
      ) : null}

      {list.isPending ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading invitations…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-caption-1-regular text-danger">
            {errorMessage(list.error, "We could not load invitations.")}
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void list.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : list.data?.rows.length === 0 ? (
        <p className="text-caption-1-regular text-fg-muted">
          No invitations have been sent yet.
        </p>
      ) : (
        <ul aria-label="Team invitations" className="flex flex-col gap-2">
          {list.data?.rows.map((invitation) => {
            const isBusy = busyId === invitation.id;
            return (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div>
                  <p className="text-caption-1-semibold text-fg">
                    {invitation.email}
                  </p>
                  <p className="text-caption-2-regular text-fg-muted">
                    {invitation.role} · {invitation.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  {canCreate && invitation.status === "pending" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      tone="grey"
                      loading={isBusy && resend.isPending}
                      onClick={() => void resendInvitation(invitation.id)}
                    >
                      Resend
                    </Button>
                  ) : null}
                  {canDelete && invitation.status === "pending" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      tone="grey"
                      loading={isBusy && revoke.isPending}
                      onClick={() => void revokeInvitation(invitation.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
