"use client";

import { Button } from "@repo/ui/button";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateSbomCiCredentialMutation,
  useRevokeSbomCiCredentialMutation,
  useSbomCiCredentialsQuery,
} from "../../_features/sboms/sboms.queries";

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "The server denied this credential action. Your owner access may have changed.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  ) {
    return "Credential management is temporarily unavailable. Try again.";
  }
  return error instanceof ApiClientError
    ? error.message
    : "The credential action could not be completed.";
}

function formatInstant(value: string | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function OrganizationSbomCiCredentialsSection({
  enabled,
  canManage,
}: Readonly<{
  enabled: boolean;
  canManage: boolean;
}>) {
  const credentials = useSbomCiCredentialsQuery(enabled && canManage);
  const create = useCreateSbomCiCredentialMutation();
  const revoke = useRevokeSbomCiCredentialMutation();
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === "") {
      setMessage("Enter a credential label.");
      return;
    }
    setMessage(null);
    setSecret(null);
    try {
      const response = await create.mutateAsync({
        label: trimmed,
        idempotencyKey: idempotencyKey(),
      });
      setSecret(response.secret);
      setLabel("");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function revokeCredential(credentialId: string) {
    setMessage(null);
    try {
      await revoke.mutateAsync({
        credentialId,
        input: { idempotencyKey: idempotencyKey() },
      });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function copySecret() {
    if (!secret || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(secret);
      setMessage("Credential copied. Store it in your CI secret manager.");
    } catch {
      setMessage(
        "Copy failed. Select the credential and store it in your CI secret manager.",
      );
    }
  }

  return (
    <section
      aria-labelledby="sbom-ci-credentials-heading"
      className="rounded-xl border border-border bg-canvas p-4 sm:p-6"
    >
      <h2
        id="sbom-ci-credentials-heading"
        className="text-title-semibold text-fg"
      >
        SBOM CI credentials
      </h2>
      <p className="mt-1 max-w-3xl text-subhead-regular text-fg-muted">
        Create narrowly scoped credentials for automated SBOM intake.
        Credentials cannot access product data or organization administration.
      </p>
      {!canManage ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          Only organization owners can create or revoke CI ingestion
          credentials.
        </p>
      ) : credentials.isPending ? (
        <p role="status" className="mt-4 text-subhead-regular text-fg-muted">
          Loading CI credentials…
        </p>
      ) : credentials.isError ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-subhead-regular text-danger">
            Credential management is temporarily unavailable.
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void credentials.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-5 grid gap-5">
          <form
            noValidate
            onSubmit={(event) => void createCredential(event)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-2 text-caption-1-regular text-fg">
              Credential label
              <input
                aria-label="Credential label"
                value={label}
                maxLength={120}
                disabled={create.isPending}
                onChange={(event) => setLabel(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              />
            </label>
            <Button
              type="submit"
              disabled={label.trim() === ""}
              loading={create.isPending}
              loadingLabel="Creating credential"
            >
              Create credential
            </Button>
          </form>
          {secret ? (
            <div
              role="status"
              className="rounded-xl border border-warning bg-surface-subtle p-4"
            >
              <p className="text-subhead-semibold text-fg">
                Copy this credential now. It will not be shown again.
              </p>
              <code className="mt-2 block break-all rounded-lg border border-border bg-canvas p-3 text-caption-1-regular text-fg">
                {secret}
              </code>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                className="mt-3"
                onClick={() => void copySecret()}
              >
                Copy credential
              </Button>
            </div>
          ) : null}
          {message ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              {message}
            </p>
          ) : null}
          {credentials.data?.credentials.length === 0 ? (
            <p className="text-subhead-regular text-fg-muted">
              No CI credentials have been issued.
            </p>
          ) : (
            <ul
              aria-label="SBOM CI credentials"
              className="divide-y divide-border rounded-xl border border-border"
            >
              {credentials.data?.credentials.map((credential) => (
                <li
                  key={credential.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words text-subhead-semibold text-fg">
                      {credential.label}
                    </p>
                    <p className="mt-1 text-caption-1-regular text-fg-muted">
                      {credential.tokenPrefix} · last used{" "}
                      {formatInstant(credential.lastUsedAt)} UTC
                    </p>
                  </div>
                  {credential.revokedAt ? (
                    <span className="w-fit rounded-full border border-border px-2.5 py-1 text-caption-1-semibold text-fg-muted">
                      Revoked
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      className="border-danger text-danger"
                      loading={revoke.isPending}
                      loadingLabel="Revoking credential"
                      onClick={() => void revokeCredential(credential.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
