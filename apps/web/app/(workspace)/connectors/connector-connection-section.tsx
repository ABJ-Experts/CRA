"use client";

import { setConnectorSecretInputSchema } from "../../_features/connectors/connectors.schemas";
import type { Connector } from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";

import {
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
}: {
  connector: Connector;
  canEdit: boolean;
  isOwner: boolean;
  onReload: () => void;
}) {
  const update = useUpdateConnectorMutation(connector.id);
  const setSecret = useSetConnectorSecretMutation(connector.id);
  const test = useTestConnectorMutation(connector.id);
  const [displayName, setDisplayName] = useState(connector.displayName);
  const [mappingVersion, setMappingVersion] = useState(
    connector.mappingVersion,
  );
  const [commitPolicy, setCommitPolicy] = useState(connector.commitPolicy);
  const [connectionConfigJson, setConnectionConfigJson] = useState(() =>
    JSON.stringify(connector.connectionConfig, null, 2),
  );
  const [secretValue, setSecretValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);

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
      await update.mutateAsync({
        displayName,
        mappingVersion,
        commitPolicy,
        connectionConfig,
        expectedVersion: connector.version,
      });
      setMessage("Connector saved.");
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setMessage(errorMessage(error, "The connector could not be saved."));
    }
  }

  async function rotateSecret(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = setConnectorSecretInputSchema.safeParse({ secretValue });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Enter a secret value.");
      return;
    }
    try {
      await setSecret.mutateAsync(parsed.data);
      setSecretValue("");
      setMessage("Secret saved.");
    } catch (error) {
      setMessage(errorMessage(error, "The secret could not be saved."));
    }
  }

  async function runTest() {
    setMessage(null);
    try {
      await test.mutateAsync();
    } catch (error) {
      setMessage(errorMessage(error, "The connection test could not run."));
    }
  }

  return (
    <SectionCard title="Connection">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <TestResultBadge connector={connector} testing={test.isPending} />
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void runTest()}
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
                  {connector.hasSecret ? "Rotate secret" : "Set secret"}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={secretValue}
                    onChange={(event) => setSecretValue(event.target.value)}
                    className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  />
                </label>
                <Button
                  type="submit"
                  loading={setSecret.isPending}
                  loadingLabel="Saving secret"
                >
                  {connector.hasSecret ? "Rotate secret" : "Set secret"}
                </Button>
              </form>
            )
          ) : null}
        </div>
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
