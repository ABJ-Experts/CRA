"use client";

import {
  updateConnectorInputSchema,
  setConnectorSecretInputSchema,
} from "../../_features/connectors/connectors.schemas";
import type { Connector } from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useRef, useState } from "react";
import type { ConnectorConnectionState } from "@repo/contracts/connectors/types";
import { cn } from "@repo/ui/cn";

import {
  useRevokeConnectorSecretMutation,
  useDisconnectConnectorMutation,
  useReconnectConnectorMutation,
  useSetConnectorSecretMutation,
  useTestConnectorMutation,
  useUpdateConnectorMutation,
} from "../../_features/connectors/connectors.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

/** Reused verbatim from `support-period-retention-section.tsx` / `product-compliance-sections.tsx`. */
function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "conflict";
}

function ReloadButton({ onReload }: Readonly<{ onReload: () => void }>) {
  return (
    <Button type="button" variant="outline" tone="grey" onClick={onReload}>
      Reload current data
    </Button>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.status === 404)
    return "This connector is unavailable.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This record changed in another session. Refresh it before trying again.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the connector registry.";
  return fallback;
}

const UNAUTHORIZED_TEST_CODES = new Set(["auth_failed"]);

function TestResultBadge({
  connector,
  testing,
}: {
  connector: Connector;
  testing: boolean;
}) {
  if (testing) {
    return (
      <Tag variant="cool" size="sm">
        Testing…
      </Tag>
    );
  }
  if (connector.lastTestOutcome === "success") {
    return (
      <Tag variant="fill" tone="green" size="sm">
        Connection successful
      </Tag>
    );
  }
  if (connector.lastTestOutcome === "failure") {
    const unauthorized =
      connector.lastTestErrorCode !== null &&
      UNAUTHORIZED_TEST_CODES.has(connector.lastTestErrorCode);
    return (
      <Tag variant="fill" tone="red" size="sm">
        {unauthorized ? "Unauthorized" : "Connection failed"}
      </Tag>
    );
  }
  return (
    <Tag variant="cool" size="sm">
      Not tested yet
    </Tag>
  );
}

/** Deliverable 2: connection tab (non-secret config, secret rotation, test). */
export function ConnectorConnectionSection({
  connector,
  canEdit,
  isOwner,
  onReload,
  connection,
}: {
  connector: Connector;
  canEdit: boolean;
  isOwner: boolean;
  onReload: () => void;
  connection?: ConnectorConnectionState;
}) {
  const isReference = connector.connectorType === "reference_conformance";
  const update = useUpdateConnectorMutation(connector.id);
  const setSecret = useSetConnectorSecretMutation(connector.id);
  const test = useTestConnectorMutation(connector.id);
  const revoke = useRevokeConnectorSecretMutation(connector.id);
  const disconnect = useDisconnectConnectorMutation(connector.id);
  const reconnect = useReconnectConnectorMutation(connector.id);
  const [reason, setReason] = useState("");
  const [baseVersion, setBaseVersion] = useState(connector.version);
  const displayNameField = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(connector.displayName);
  const [mappingVersion, setMappingVersion] = useState(
    connector.mappingVersion,
  );
  const [commitPolicy, setCommitPolicy] = useState(connector.commitPolicy);
  const [connectionConfigJson, setConnectionConfigJson] = useState(() =>
    JSON.stringify(connector.connectionConfig, null, 2),
  );
  const [secretValue, setSecretValue] = useState("");
  const [privateKeyFile, setPrivateKeyFile] = useState<File | null>(null);
  const privateKeyInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);

  const changedVersion = connector.version !== baseVersion;
  const busy =
    update.isPending ||
    setSecret.isPending ||
    test.isPending ||
    revoke.isPending ||
    disconnect.isPending ||
    reconnect.isPending;
  const dirty =
    displayName !== connector.displayName ||
    mappingVersion !== connector.mappingVersion ||
    commitPolicy !== connector.commitPolicy ||
    connectionConfigJson !==
      JSON.stringify(connector.connectionConfig, null, 2);
  function discardDraft() {
    setDisplayName(connector.displayName);
    setMappingVersion(connector.mappingVersion);
    setCommitPolicy(connector.commitPolicy);
    setConnectionConfigJson(
      JSON.stringify(connector.connectionConfig, null, 2),
    );
    setBaseVersion(connector.version);
    setStaleUpdate(false);
    displayNameField.current?.focus();
  }
  async function control(action: "revoke" | "disconnect" | "reconnect") {
    setMessage(null);
    const input = {
      expectedVersion: connector.version,
      idempotencyKey: crypto.randomUUID(),
      reason,
    };
    if (action !== "reconnect" && !reason.trim()) {
      setMessage("Enter a reason for this action.");
      return;
    }
    try {
      const result =
        action === "revoke"
          ? await revoke.mutateAsync(input)
          : action === "disconnect"
            ? await disconnect.mutateAsync(input)
            : await reconnect.mutateAsync({
                expectedVersion: input.expectedVersion,
                idempotencyKey: input.idempotencyKey,
              });
      if (!dirty) setBaseVersion(result.connector.version);
      setReason("");
      setMessage(
        action === "revoke"
          ? "Credential revoked; future jobs are stopped."
          : action === "disconnect"
            ? "Disconnected; future jobs are stopped."
            : "Reconnected; test again before starting new work.",
      );
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(
        errorMessage(error, "The connection action could not be completed."),
      );
    }
  }

  async function saveConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    let connectionConfig: Record<string, unknown>;
    try {
      connectionConfig = JSON.parse(connectionConfigJson) as Record<
        string,
        unknown
      >;
    } catch {
      setMessage("Connection config must be valid JSON.");
      return;
    }
    try {
      const parsed = updateConnectorInputSchema.safeParse({
        displayName,
        mappingVersion,
        commitPolicy,
        connectionConfig,
        expectedVersion: baseVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!parsed.success) {
        setMessage(
          "Check configuration metadata. Only supported non-secret fields are allowed.",
        );
        return;
      }
      const result = await update.mutateAsync(parsed.data);
      setBaseVersion(result.connector.version);
      setMessage(
        isReference
          ? "Connector saved. Test again before starting new work."
          : "Connector saved. Provider identity is verified when a binding or run is used.",
      );
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(errorMessage(error, "The connector could not be saved."));
    }
  }

  async function rotateSecret(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    let credential = secretValue;
    if (connector.connectorType === "github_actions") {
      if (!privateKeyFile || privateKeyFile.size > 20_000) {
        setMessage("Choose a GitHub App private key file under 20 KB.");
        return;
      }
      try {
        credential = await privateKeyFile.text();
      } catch {
        setMessage("The GitHub App private key file could not be read.");
        return;
      }
    }
    const parsed = setConnectorSecretInputSchema.safeParse({
      secretValue: credential,
      expectedVersion: connector.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Enter a secret value.");
      return;
    }
    try {
      const result = await setSecret.mutateAsync(parsed.data);
      if (!dirty) setBaseVersion(result.connector.version);
      setSecretValue("");
      setPrivateKeyFile(null);
      if (privateKeyInput.current) privateKeyInput.current.value = "";
      setMessage("Secret saved.");
    } catch (error) {
      setMessage(errorMessage(error, "The secret could not be saved."));
    }
  }

  async function runTest() {
    setMessage(null);
    try {
      await test.mutateAsync({
        expectedVersion: connector.version,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (error) {
      setMessage(errorMessage(error, "The connection test could not run."));
    }
  }

  return (
    <SectionCard title="Connection">
      <p className={cn("mb-4 text-subhead-regular text-fg")}>
        {isReference
          ? "Reference adapter only: tests validate local fixtures and do not contact a vendor."
          : "This CI connection verifies provider runs for owner-approved release bindings. Save its provider credential in the vault below before binding."}
      </p>
      {connection ? (
        <div className="mb-4 space-y-2" aria-live="polite">
          <p className="text-subhead-semibold text-fg">
            State: {connection.status.replaceAll("_", " ")}
          </p>
          <p className="text-subhead-regular text-fg">
            {connection.test.message}
          </p>
          <p className="text-caption-1-regular text-fg">
            Last sync:{" "}
            {connection.lastSyncAt
              ? new Date(connection.lastSyncAt).toLocaleString()
              : "Never"}
          </p>
          <h3 className="text-subhead-semibold text-fg">
            Least-privilege guidance
          </h3>
          <p className="text-caption-1-regular text-fg">
            {isReference
              ? "Use disposable fixture credentials only."
              : "Use the narrowest provider scope and rotate credentials before expiry. Enable the connection after saving its secret."}{" "}
            Scope policy {connection.scope.policyVersion}. Scope introspection:{" "}
            {connection.scope.status.replaceAll("_", " ")}.
          </p>
          {connection.scope.warnings.map((warning) => (
            <p
              key={warning}
              role="status"
              className="text-caption-1-regular text-fg"
            >
              {warning.replaceAll("_", " ")}
            </p>
          ))}
          {connection.scope.missingScopes.length ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              Required privileges missing:{" "}
              {connection.scope.missingScopes.join(", ")}
            </p>
          ) : null}
          {connection.scope.excessScopes.length ? (
            <p className="text-caption-1-regular text-fg">
              Excess privileges: {connection.scope.excessScopes.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {changedVersion ? (
        <div role="status" className="mb-4 space-y-2">
          <p className="text-subhead-regular text-fg">
            A newer configuration is available. Your draft has been preserved.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={discardDraft}
            >
              Discard draft and use current data
            </Button>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => {
                setBaseVersion(connector.version);
                setStaleUpdate(false);
                displayNameField.current?.focus();
              }}
            >
              Reapply draft to current version
            </Button>
          </div>
        </div>
      ) : dirty ? (
        <p role="status" className="mb-4 text-caption-1-regular text-fg">
          Unsaved configuration changes
        </p>
      ) : null}
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          {isReference ? (
            <TestResultBadge connector={connector} testing={test.isPending} />
          ) : null}
          {canEdit && isReference ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void runTest()}
              disabled={
                busy || !connector.hasSecret || connector.archivedAt !== null
              }
              loading={test.isPending}
              loadingLabel="Testing connection"
            >
              Test connection
            </Button>
          ) : null}
        </div>
        {canEdit ? (
          <form
            className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2"
            noValidate
            onSubmit={saveConnection}
          >
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Display name
              <input
                ref={displayNameField}
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              />
            </label>
            <label
              className="flex flex-col gap-2 text-caption-1-regular text-fg"
              htmlFor="connector-commit-policy-edit"
            >
              Commit policy
              <select
                id="connector-commit-policy-edit"
                value={commitPolicy}
                onChange={(event) =>
                  setCommitPolicy(event.target.value as "manual" | "auto")
                }
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                <option value="manual">Manual commit</option>
                <option value="auto">Auto commit</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Adapter version
              <input
                disabled
                readOnly
                value={connector.adapterVersion}
                aria-readonly="true"
                className="h-10 rounded-xl border border-border bg-surface-subtle px-3 text-subhead-regular text-fg-muted"
              />
              <span className="text-caption-1-regular text-fg-muted">
                Fixed at creation.
              </span>
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Mapping version
              <input
                required
                value={mappingVersion}
                onChange={(event) => setMappingVersion(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
              Connection config (JSON, no secrets)
              <textarea
                value={connectionConfigJson}
                onChange={(event) =>
                  setConnectionConfigJson(event.target.value)
                }
                className="min-h-28 rounded-xl border border-border bg-canvas px-3 py-2 font-mono text-caption-1-regular text-fg"
              />
            </label>
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={changedVersion || busy}
                loading={update.isPending}
                loadingLabel="Saving connector"
              >
                Save connection
              </Button>
            </div>
          </form>
        ) : null}
        <div className="border-t border-border pt-5">
          <h3 className="text-headline-semibold text-fg">Secret</h3>
          {!isReference ? (
            <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
              {connector.connectorType === "github_actions"
                ? "GitHub App private key credential"
                : connector.connectorType === "gitlab_ci"
                  ? "Project-scoped GitLab access token"
                  : "Project-scoped Azure DevOps access bearer (rotate before expiry)"}
              . This value is never shown after saving.
            </p>
          ) : null}
          {connector.connectorType === "github_actions" ? (
            <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
              The GitHub App needs Actions: read for run verification and
              Contents: read for release tag verification on the bound
              repositories. Manual workflow_dispatch runs are unsupported.
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-3">
            <Tag
              variant="fill"
              tone={connector.hasSecret ? "green" : "orange"}
              size="sm"
            >
              {connector.hasSecret ? "Configured" : "Not configured"}
            </Tag>
          </div>
          {canEdit ? (
            !isOwner ? (
              <p
                role="alert"
                className="mt-3 text-caption-1-regular text-danger"
              >
                Only the organization owner can set or rotate this
                connector&apos;s secret.
              </p>
            ) : (
              <form
                className="mt-3 flex flex-wrap items-end gap-3"
                noValidate
                onSubmit={(event) => void rotateSecret(event)}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-2 text-caption-1-regular text-fg">
                  {connector.connectorType === "github_actions"
                    ? "GitHub App private key file"
                    : connector.hasSecret
                      ? "Rotate secret"
                      : "Set secret"}
                  {connector.connectorType === "github_actions" ? (
                    <input
                      ref={privateKeyInput}
                      type="file"
                      accept=".pem,.key,text/plain"
                      onChange={(event) =>
                        setPrivateKeyFile(event.target.files?.[0] ?? null)
                      }
                      className="h-10 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
                    />
                  ) : (
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={secretValue}
                      onChange={(event) => setSecretValue(event.target.value)}
                      className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                    />
                  )}
                </label>
                <Button
                  type="submit"
                  disabled={busy}
                  loading={setSecret.isPending}
                  loadingLabel="Saving secret"
                >
                  {connector.hasSecret ? "Rotate secret" : "Set secret"}
                </Button>
              </form>
            )
          ) : null}
        </div>
        {canEdit ? (
          <div className="space-y-3 border-t border-border pt-5">
            <h3 className="text-headline-semibold text-fg">
              Connection controls
            </h3>
            <p className="text-caption-1-regular text-fg">
              Disconnect stops future jobs. In-flight reads may finish, but
              stale work cannot commit or advance the cursor.
            </p>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Reason for disconnect or revoke
              <input
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {connector.enabled ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  disabled={busy}
                  onClick={() => void control("disconnect")}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  disabled={
                    busy ||
                    !connector.hasSecret ||
                    connector.archivedAt !== null
                  }
                  onClick={() => void control("reconnect")}
                >
                  Reconnect
                </Button>
              )}
              {isOwner && connector.hasSecret ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  disabled={busy}
                  onClick={() => void control("revoke")}
                >
                  Revoke credential
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {message ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-caption-1-regular text-danger">
              {message}
            </p>
            {staleUpdate ? <ReloadButton onReload={onReload} /> : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
