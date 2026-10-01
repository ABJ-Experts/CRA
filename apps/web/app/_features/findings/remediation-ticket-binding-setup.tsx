"use client";

import {
  dryRunVulnerabilityRemediationTicketBindingInputSchema,
  type DryRunVulnerabilityRemediationTicketBindingInput,
  type VulnerabilityRemediationTicketBinding,
} from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import { useState } from "react";

import { useConnectorOverviewsQuery } from "../connectors/connectors.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  useDryRunVulnerabilityRemediationTicketBindingMutation,
  useUpsertVulnerabilityRemediationTicketBindingMutation,
  useVulnerabilityTriageDetailQuery,
} from "./triage.queries";

type Draft = Readonly<{
  connectorId: string;
  projectId: string;
  projectKey: string;
  issueTypeId: string;
  statusTransitions: string;
  statusMappings: string;
  customFieldMappings: string;
  expectedBindingId: string | null;
  expectedVersion: number | null;
}>;

const emptyDraft: Draft = {
  connectorId: "",
  projectId: "",
  projectKey: "",
  issueTypeId: "",
  statusTransitions: "[]",
  statusMappings: "[]",
  customFieldMappings: "[]",
  expectedBindingId: null,
  expectedVersion: null,
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function requestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "Owner access was revoked. Ask an organization owner to review this mapping.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The binding changed in another session. Your edits remain here; reload current binding before validating again.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your mapping edits remain here; reconnect and validate again.";
  return "Jira validation is unavailable. Your mapping edits remain here; retry when the connection is ready.";
}

export function RemediationTicketBindingSetup({
  findingId,
  bindings,
}: Readonly<{
  findingId: string;
  bindings: readonly VulnerabilityRemediationTicketBinding[];
}>) {
  const detail = useVulnerabilityTriageDetailQuery(findingId, true);
  const [page, setPage] = useState(1);
  const connectors = useConnectorOverviewsQuery({ page, pageSize: 50 }, true);
  const dryRun = useDryRunVulnerabilityRemediationTicketBindingMutation();
  const upsert = useUpsertVulnerabilityRemediationTicketBindingMutation();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [rememberedConnector, setRememberedConnector] = useState<{
    id: string;
    name: string;
    cloudId: unknown;
  } | null>(null);
  const [validated, setValidated] = useState<string | null>(null);
  const [saveKey, setSaveKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<readonly string[]>([]);
  const choices = (connectors.data?.connectors.rows ?? []).filter(
    ({ connector }) =>
      connector.connectorType === "jira" &&
      connector.enabled &&
      connector.archivedAt === null,
  );
  const choice = choices.find(
    ({ connector }) => connector.id === draft.connectorId,
  );
  const selectedBinding = bindings.find(
    (binding) =>
      binding.id === draft.expectedBindingId &&
      binding.connectorId === draft.connectorId,
  );
  const cloudId =
    choice?.connector.connectionConfig.cloudId ??
    (rememberedConnector?.id === draft.connectorId
      ? rememberedConnector.cloudId
      : undefined) ??
    selectedBinding?.cloudId;
  const parsed =
    dryRunVulnerabilityRemediationTicketBindingInputSchema.safeParse({
      connectorId: draft.connectorId,
      productId: detail.data?.detail.finding.productId,
      cloudId,
      projectId: draft.projectId,
      projectKey: draft.projectKey,
      issueTypeId: draft.issueTypeId,
      statusTransitions: parseJson(draft.statusTransitions),
      statusMappings: parseJson(draft.statusMappings),
      customFieldMappings: parseJson(draft.customFieldMappings),
    });
  const input: DryRunVulnerabilityRemediationTicketBindingInput | null =
    parsed.success ? parsed.data : null;
  const fingerprint = input === null ? null : JSON.stringify(input);
  const readyToSave =
    input !== null &&
    fingerprint === validated &&
    !dryRun.isPending &&
    !upsert.isPending &&
    !detail.isLoading &&
    !detail.isError &&
    !connectors.isLoading &&
    !connectors.isError;

  function change(field: keyof Draft, value: string) {
    if (field === "connectorId") {
      const selected = choices.find(
        ({ connector }) => connector.id === value,
      )?.connector;
      setRememberedConnector(
        selected
          ? {
              id: selected.id,
              name: selected.displayName,
              cloudId: selected.connectionConfig.cloudId,
            }
          : null,
      );
    }
    setDraft((current) => ({ ...current, [field]: value }));
    setValidated(null);
    setSaveKey(null);
    setMessage(null);
    setFieldErrors([]);
  }

  function loadBinding(binding: VulnerabilityRemediationTicketBinding) {
    setDraft({
      connectorId: binding.connectorId,
      projectId: binding.projectId,
      projectKey: binding.projectKey,
      issueTypeId: binding.issueTypeId,
      statusTransitions: JSON.stringify(binding.statusTransitions, null, 2),
      statusMappings: JSON.stringify(binding.statusMappings, null, 2),
      customFieldMappings: JSON.stringify(binding.customFieldMappings, null, 2),
      expectedBindingId: binding.id,
      expectedVersion: binding.version,
    });
    setValidated(null);
    setSaveKey(null);
    setMessage(null);
    setFieldErrors([]);
  }

  async function validate() {
    if (input === null || fingerprint === null) {
      setFieldErrors(
        parsed.success
          ? []
          : parsed.error.issues.map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`,
            ),
      );
      setMessage("Correct the mapping fields before validating.");
      return;
    }
    setValidated(null);
    setFieldErrors([]);
    setMessage(null);
    try {
      const result = await dryRun.mutateAsync(input);
      if (result.valid) {
        setValidated(fingerprint);
        setMessage("Jira mapping validated. Review it, then save explicitly.");
      } else {
        setFieldErrors(
          result.errors.map(
            (error) => `${error.fieldId ?? error.code}: ${error.message}`,
          ),
        );
        setMessage(
          "Jira rejected this mapping. Review the validation details.",
        );
      }
    } catch (error) {
      setMessage(requestMessage(error));
    }
  }

  async function save() {
    if (!readyToSave || input === null) return;
    const key = saveKey ?? crypto.randomUUID();
    setSaveKey(key);
    setMessage(null);
    try {
      const result = await upsert.mutateAsync({
        ...input,
        ...(draft.expectedBindingId && draft.expectedVersion
          ? {
              expectedBindingId: draft.expectedBindingId,
              expectedVersion: draft.expectedVersion,
            }
          : {}),
        idempotencyKey: key,
      });
      loadBinding(result.binding);
      setMessage(
        "Jira binding saved. Ticket creation still requires an approved preview.",
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409)
        setValidated(null);
      setMessage(requestMessage(error));
    }
  }

  return (
    <section
      className={cn("mt-4 rounded-lg border border-border bg-canvas p-4")}
      aria-labelledby="jira-binding-setup-heading"
    >
      <h5
        id="jira-binding-setup-heading"
        className="text-subhead-semibold text-fg"
      >
        Owner Jira binding setup
      </h5>
      <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
        Select the authorized Jira connection, enter explicit project and
        workflow IDs, validate with Jira, then save. No credential is shown
        here.
      </p>
      {detail.isLoading || connectors.isLoading ? (
        <p
          role="status"
          className={cn("mt-3 text-caption-1-regular text-fg-muted")}
        >
          Loading finding and Jira connections…
        </p>
      ) : null}
      {detail.isError || connectors.isError ? (
        <div
          role="alert"
          className={cn("mt-3 text-caption-1-regular text-danger")}
        >
          Binding setup is unavailable. Existing remediation evidence remains
          usable.
          <Button
            size="sm"
            variant="gap"
            tone="grey"
            onClick={() => {
              void detail.refetch();
              void connectors.refetch();
            }}
          >
            Retry setup
          </Button>
        </div>
      ) : null}
      {!detail.isLoading &&
      !detail.isError &&
      !connectors.isLoading &&
      !connectors.isError ? (
        <>
          {bindings.length ? (
            <div className={cn("mt-3 flex flex-wrap gap-2")}>
              {bindings.map((binding) => (
                <Button
                  key={binding.id}
                  size="sm"
                  variant="outline"
                  tone="grey"
                  onClick={() => loadBinding(binding)}
                >
                  Edit {binding.projectKey} · {binding.status}
                </Button>
              ))}
            </div>
          ) : null}
          <div className={cn("mt-3 grid gap-3 sm:grid-cols-2")}>
            <label className={cn("text-caption-1-regular text-fg")}>
              Jira connection
              <select
                className={cn(
                  "mt-1 w-full rounded-md border border-border bg-canvas p-2 text-fg",
                )}
                value={draft.connectorId}
                onChange={(event) => change("connectorId", event.target.value)}
              >
                <option value="">Select a configured connection</option>
                {selectedBinding && !choice ? (
                  <option value={selectedBinding.connectorId}>
                    Current binding connection · {selectedBinding.connectorId}
                  </option>
                ) : null}
                {rememberedConnector && !choice && !selectedBinding ? (
                  <option value={rememberedConnector.id}>
                    {rememberedConnector.name} · {rememberedConnector.id}
                  </option>
                ) : null}
                {choices.map(({ connector }) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.displayName} · {connector.id}
                  </option>
                ))}
              </select>
            </label>
            <label className={cn("text-caption-1-regular text-fg")}>
              Jira project ID
              <Input
                className={cn("mt-1")}
                value={draft.projectId}
                onChange={(event) => change("projectId", event.target.value)}
              />
            </label>
            <label className={cn("text-caption-1-regular text-fg")}>
              Jira project key
              <Input
                className={cn("mt-1")}
                value={draft.projectKey}
                onChange={(event) => change("projectKey", event.target.value)}
              />
            </label>
            <label className={cn("text-caption-1-regular text-fg")}>
              Issue type ID
              <Input
                className={cn("mt-1")}
                value={draft.issueTypeId}
                onChange={(event) => change("issueTypeId", event.target.value)}
              />
            </label>
          </div>
          <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
            Use Jira IDs from the approved project. Each JSON field is validated
            against the shared contract and the provider before saving.
          </p>
          {(
            [
              ["statusTransitions", "Status transitions JSON"],
              ["statusMappings", "Status mappings JSON"],
              ["customFieldMappings", "Custom field mappings JSON"],
            ] as const
          ).map(([field, label]) => (
            <label
              key={field}
              className={cn("mt-3 block text-caption-1-regular text-fg")}
            >
              {label}
              <textarea
                className={cn(
                  "mt-1 min-h-24 w-full rounded-md border border-border bg-canvas p-2 font-mono text-caption-1-regular text-fg",
                )}
                value={draft[field]}
                onChange={(event) => change(field, event.target.value)}
                spellCheck={false}
              />
            </label>
          ))}
          {choices.length === 0 ? (
            <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
              No active Jira connection is on this page. Configure one in the
              integration hub or browse connector pages.
            </p>
          ) : null}
          <div className={cn("mt-3 flex items-center gap-2")}>
            <Button
              size="sm"
              variant="outline"
              tone="grey"
              disabled={upsert.isPending}
              loading={dryRun.isPending}
              onClick={() => void validate()}
            >
              Validate Jira mapping
            </Button>
            <Button
              size="sm"
              variant="outline"
              tone="grey"
              disabled={!readyToSave}
              loading={upsert.isPending}
              onClick={() => void save()}
            >
              Save Jira binding
            </Button>
          </div>
          {connectors.data && connectors.data.connectors.pageCount > 1 ? (
            <div
              className={cn(
                "mt-3 flex items-center gap-2 text-caption-1-regular text-fg-muted",
              )}
            >
              <Button
                size="sm"
                variant="gap"
                tone="grey"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous connections
              </Button>
              Page {page} of {connectors.data.connectors.pageCount}
              <Button
                size="sm"
                variant="gap"
                tone="grey"
                disabled={page >= connectors.data.connectors.pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                Next connections
              </Button>
            </div>
          ) : null}
          {fieldErrors.length ? (
            <ul
              role="alert"
              className={cn(
                "mt-3 list-disc pl-5 text-caption-1-regular text-danger",
              )}
            >
              {fieldErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
          {message ? (
            <p
              role="status"
              className={cn("mt-3 text-caption-1-regular text-fg")}
            >
              {message}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
