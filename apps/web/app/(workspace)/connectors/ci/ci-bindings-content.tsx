"use client";

import {
  upsertCiProviderReleaseBindingInputSchema,
  type CiProvider,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useState } from "react";

import { useConnectorOverviewsQuery } from "../../../_features/connectors/connectors.queries";
import {
  useProductsQuery,
  useProductReleasesQuery,
} from "../../../_features/products/products.queries";
import {
  useCiBindingRunsQuery,
  useCiBindingsQuery,
  useCreateCiBindingMutation,
  useRevokeCiBindingMutation,
} from "../../../_features/sboms/ci-bindings.queries";
import { useSbomCiCredentialsQuery } from "../../../_features/sboms/sboms.queries";
import { ApiClientError } from "../../../_lib/http/api-client";
import { useMocksReady } from "../../../_providers/providers";
import { useSession } from "../../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../../dashboard/_components/dashboard-chrome";

const fieldClass = cn(
  "h-10 w-full rounded-lg border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500",
);
const labelClass = cn("grid gap-1 text-caption-1-semibold text-fg");
const providerNames: Record<CiProvider, string> = {
  github_actions: "GitHub Actions",
  gitlab_ci: "GitLab CI",
  azure_devops: "Azure DevOps",
};

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "Owner access changed. Reload this workspace before retrying.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This binding conflicts with a newer mapping or another repository. Reload and review the current binding.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" || error.kind === "invalid_response")
  )
    return "The CI integration service is unavailable. Your form values are preserved.";
  return error instanceof ApiClientError
    ? error.message
    : "The CI binding could not be saved. Your form values are preserved.";
}

export function CiBindingsContent() {
  const mocksReady = useMocksReady();
  const { session, role, permissions } = useSession();
  const enabled =
    mocksReady &&
    process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false" &&
    Boolean(session?.organization?.id);
  const canManage =
    role === "owner" && permissions.can_view_connectors === true;
  const bindings = useCiBindingsQuery(enabled && canManage);
  const connectors = useConnectorOverviewsQuery(
    { page: 1, pageSize: 100 },
    enabled && canManage,
  );
  const credentials = useSbomCiCredentialsQuery(enabled && canManage);
  const [productSearch, setProductSearch] = useState("");
  const products = useProductsQuery(
    { page: 1, pageSize: 100, q: productSearch.trim() || undefined },
    enabled && canManage,
  );
  const [connectorId, setConnectorId] = useState("");
  const [productId, setProductId] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [repositoryOwner, setRepositoryOwner] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [allowedRef, setAllowedRef] = useState("");
  const [providerHost, setProviderHost] = useState("github.com");
  const [providerInstallationId, setProviderInstallationId] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [pipelineDefinitionId, setPipelineDefinitionId] = useState("");
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [releasePage, setReleasePage] = useState(1);
  const releases = useProductReleasesQuery(
    productId,
    { page: releasePage, pageSize: 100 },
    enabled && canManage && productId !== "",
  );
  const runs = useCiBindingRunsQuery(selectedBindingId, enabled && canManage);
  const create = useCreateCiBindingMutation();
  const revoke = useRevokeCiBindingMutation();
  const availableConnectors = (connectors.data?.connectors.rows ?? []).filter(
    ({ connector }) =>
      connector.connectorType !== "reference_conformance" &&
      connector.enabled &&
      !connector.archivedAt,
  );
  const selectedConnector = availableConnectors.find(
    ({ connector }) => connector.id === connectorId,
  )?.connector;
  const provider = selectedConnector?.connectorType as CiProvider | undefined;
  const dependenciesPending =
    connectors.isPending || credentials.isPending || products.isPending;
  const dependenciesError =
    connectors.isError ||
    credentials.isError ||
    products.isError ||
    (productId !== "" && releases.isError);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = upsertCiProviderReleaseBindingInputSchema.safeParse({
      connectorId,
      productId,
      releaseId,
      credentialId,
      provider,
      providerHost,
      repositoryOwner,
      repositoryName,
      repositoryId,
      allowedRef,
      ...(provider === "github_actions" ? { providerInstallationId } : {}),
      ...(projectKey.trim() ? { projectKey } : {}),
      ...(pipelineDefinitionId.trim() ? { pipelineDefinitionId } : {}),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the binding fields.",
      );
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setMessage("Binding created. Use its ID in the provider template.");
      setRepositoryOwner("");
      setRepositoryName("");
      setRepositoryId("");
      setAllowedRef("");
      setProviderInstallationId("");
      setProjectKey("");
      setPipelineDefinitionId("");
    } catch (error) {
      setMessage(messageFor(error));
    }
  }

  async function revokeBinding(bindingId: string, expectedVersion: number) {
    setMessage(null);
    try {
      await revoke.mutateAsync({
        bindingId,
        input: {
          expectedBindingId: bindingId,
          expectedVersion,
          reason: "Owner revoked CI release mapping",
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (selectedBindingId === bindingId) setSelectedBindingId(null);
    } catch (error) {
      setMessage(messageFor(error));
    }
  }

  return (
    <div className={cn("flex flex-col gap-6 px-6 py-6 lg:px-[30px]")}>
      <PageHeading
        title="CI SBOM bindings"
        subtitle="Map provider builds to an authorized product release and review intake status."
      />
      {!enabled ? (
        <SectionCard>
          <p className={cn("text-subhead-regular text-fg-muted")}>
            CI integrations require the live backend and an organization.
          </p>
        </SectionCard>
      ) : !canManage ? (
        <SectionCard>
          <p className={cn("text-subhead-regular text-fg-muted")}>
            Only organization owners can manage CI bindings.
          </p>
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Create release binding">
            <p
              className={cn(
                "mb-4 max-w-3xl text-subhead-regular text-fg-muted",
              )}
            >
              Configure a provider connector and CI credential first. The server
              verifies the stable provider identity and owns the product and
              release mapping.
            </p>
            <p className={cn("mb-4 text-subhead-regular text-fg-muted")}>
              <Link
                href="/connectors"
                className={cn(
                  "underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-active-500",
                )}
              >
                Configure connector
              </Link>{" "}
              ·{" "}
              <Link
                href="/organization"
                className={cn(
                  "underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-active-500",
                )}
              >
                Manage CI credentials
              </Link>
            </p>
            {dependenciesPending ? (
              <p
                role="status"
                className={cn("mb-4 text-subhead-regular text-fg-muted")}
              >
                Loading connectors, credentials and products…
              </p>
            ) : null}
            {dependenciesError ? (
              <p
                role="alert"
                className={cn("mb-4 text-subhead-regular text-danger")}
              >
                Binding choices are unavailable. Retry after the integration
                service recovers.
              </p>
            ) : null}
            <form
              noValidate
              onSubmit={(event) => void save(event)}
              className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3")}
            >
              <label className={labelClass}>
                Connector
                <select
                  aria-label="Connector"
                  className={fieldClass}
                  value={connectorId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setConnectorId(next);
                    const selected = availableConnectors.find(
                      ({ connector }) => connector.id === next,
                    )?.connector;
                    setProviderHost(
                      selected?.connectorType === "gitlab_ci"
                        ? "gitlab.com"
                        : selected?.connectorType === "azure_devops"
                          ? "dev.azure.com"
                          : "github.com",
                    );
                  }}
                >
                  <option value="">Select connector</option>
                  {availableConnectors.map(({ connector }) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.displayName} (
                      {providerNames[connector.connectorType as CiProvider]})
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                CI credential
                <select
                  aria-label="CI credential"
                  className={fieldClass}
                  value={credentialId}
                  onChange={(event) => setCredentialId(event.target.value)}
                >
                  <option value="">Select credential</option>
                  {(credentials.data?.credentials ?? [])
                    .filter((credential) => !credential.revokedAt)
                    .map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {credential.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className={labelClass}>
                Product search
                <input
                  className={fieldClass}
                  value={productSearch}
                  onChange={(event) => {
                    setProductSearch(event.target.value);
                    setProductId("");
                    setReleaseId("");
                  }}
                  placeholder="Filter products"
                />
              </label>
              <label className={labelClass}>
                Product
                <select
                  aria-label="Product"
                  className={fieldClass}
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    setReleaseId("");
                    setReleasePage(1);
                  }}
                >
                  <option value="">Select product</option>
                  {(products.data?.products.rows ?? []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Release
                <select
                  aria-label="Release"
                  className={fieldClass}
                  value={releaseId}
                  onChange={(event) => setReleaseId(event.target.value)}
                >
                  <option value="">Select release</option>
                  {(releases.data?.releases.rows ?? []).map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.label} ({release.version})
                    </option>
                  ))}
                </select>
              </label>
              {productId && (releases.data?.releases.pageCount ?? 1) > 1 ? (
                <div className={cn("flex items-end gap-2")}>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    disabled={releasePage === 1}
                    onClick={() => {
                      setReleasePage((page) => page - 1);
                      setReleaseId("");
                    }}
                  >
                    Previous releases
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    disabled={
                      releasePage >= (releases.data?.releases.pageCount ?? 1)
                    }
                    onClick={() => {
                      setReleasePage((page) => page + 1);
                      setReleaseId("");
                    }}
                  >
                    Next releases
                  </Button>
                </div>
              ) : null}
              <label className={labelClass}>
                Provider host
                <input
                  className={fieldClass}
                  value={providerHost}
                  onChange={(event) => setProviderHost(event.target.value)}
                />
              </label>
              <label className={labelClass}>
                Repository owner
                <input
                  className={fieldClass}
                  value={repositoryOwner}
                  maxLength={120}
                  onChange={(event) => setRepositoryOwner(event.target.value)}
                />
              </label>
              <label className={labelClass}>
                Repository name
                <input
                  className={fieldClass}
                  value={repositoryName}
                  maxLength={160}
                  onChange={(event) => setRepositoryName(event.target.value)}
                />
              </label>
              <label className={labelClass}>
                Repository ID
                <input
                  className={fieldClass}
                  value={repositoryId}
                  maxLength={160}
                  onChange={(event) => setRepositoryId(event.target.value)}
                />
              </label>
              <label className={labelClass}>
                Allowed ref
                <input
                  className={fieldClass}
                  value={allowedRef}
                  maxLength={500}
                  placeholder="refs/heads/main"
                  onChange={(event) => setAllowedRef(event.target.value)}
                />
              </label>
              {provider === "github_actions" ? (
                <label className={labelClass}>
                  GitHub App installation ID
                  <input
                    className={fieldClass}
                    value={providerInstallationId}
                    maxLength={160}
                    onChange={(event) =>
                      setProviderInstallationId(event.target.value)
                    }
                  />
                </label>
              ) : null}
              {provider === "gitlab_ci" ? (
                <label className={labelClass}>
                  Project path (optional)
                  <input
                    className={fieldClass}
                    value={projectKey}
                    maxLength={200}
                    onChange={(event) => setProjectKey(event.target.value)}
                  />
                </label>
              ) : null}
              {provider === "azure_devops" ? (
                <>
                  <label className={labelClass}>
                    Team project
                    <input
                      className={fieldClass}
                      value={projectKey}
                      maxLength={200}
                      onChange={(event) => setProjectKey(event.target.value)}
                    />
                  </label>
                  <label className={labelClass}>
                    Pipeline definition ID
                    <input
                      className={fieldClass}
                      value={pipelineDefinitionId}
                      maxLength={200}
                      onChange={(event) =>
                        setPipelineDefinitionId(event.target.value)
                      }
                    />
                  </label>
                </>
              ) : null}
              <div
                className={cn(
                  "flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-3",
                )}
              >
                <Button
                  type="submit"
                  disabled={
                    dependenciesPending ||
                    dependenciesError ||
                    releases.isPending
                  }
                  loading={create.isPending}
                  loadingLabel="Creating binding"
                >
                  Create binding
                </Button>
                {message ? (
                  <p
                    role="alert"
                    className={cn("text-subhead-regular text-fg")}
                  >
                    {message}
                  </p>
                ) : null}
              </div>
            </form>
          </SectionCard>
          <SectionCard title="Release bindings and recent builds">
            {bindings.isPending ? (
              <p
                role="status"
                className={cn("text-subhead-regular text-fg-muted")}
              >
                Loading CI bindings…
              </p>
            ) : bindings.isError ? (
              <div role="alert" className={cn("flex items-center gap-3")}>
                <p className={cn("text-subhead-regular text-danger")}>
                  CI bindings are unavailable.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void bindings.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : bindings.data?.bindings.length === 0 ? (
              <p className={cn("text-subhead-regular text-fg-muted")}>
                No CI release bindings have been created.
              </p>
            ) : (
              <div className={cn("overflow-x-auto")}>
                <table
                  className={cn(
                    "w-full text-left text-caption-1-regular text-fg",
                  )}
                >
                  <caption className="sr-only">CI release bindings</caption>
                  <thead>
                    <tr className={cn("border-b border-border")}>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Provider and repository
                      </th>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Product / release
                      </th>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Status
                      </th>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bindings.data?.bindings.map((binding) => (
                      <tr
                        key={binding.id}
                        className={cn("border-b border-border align-top")}
                      >
                        <td className={cn("px-3 py-3")}>
                          <span className={cn("font-medium")}>
                            {providerNames[binding.provider]}
                          </span>
                          <br />
                          {binding.repositoryOwner}/{binding.repositoryName}
                          <br />
                          <code className={cn("break-all text-fg-muted")}>
                            ID {binding.repositoryId} · binding {binding.id}
                            <br />
                            Ref {binding.allowedRef}
                          </code>
                        </td>
                        <td className={cn("px-3 py-3")}>
                          <Link
                            href={`/products/${binding.productId}`}
                            className={cn("underline underline-offset-4")}
                          >
                            {binding.productId}
                          </Link>
                          <br />
                          <span className={cn("break-all text-fg-muted")}>
                            Release {binding.releaseId}
                          </span>
                        </td>
                        <td className={cn("px-3 py-3")}>
                          {binding.status === "active" ? "Active" : "Revoked"}
                        </td>
                        <td className={cn("flex flex-wrap gap-2 px-3 py-3")}>
                          <Button
                            type="button"
                            variant="outline"
                            tone="grey"
                            onClick={() => setSelectedBindingId(binding.id)}
                          >
                            Recent builds
                          </Button>
                          {binding.status === "active" ? (
                            <Button
                              type="button"
                              variant="outline"
                              tone="grey"
                              loading={revoke.isPending}
                              loadingLabel="Revoking binding"
                              onClick={() =>
                                void revokeBinding(binding.id, binding.version)
                              }
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selectedBindingId ? (
              <section
                aria-label="Recent CI builds"
                className={cn("mt-5 border-t border-border pt-4")}
              >
                <h3 className={cn("text-subhead-semibold text-fg")}>
                  Recent builds for {selectedBindingId}
                </h3>
                {runs.isPending ? (
                  <p role="status">Loading builds…</p>
                ) : runs.isError ? (
                  <div role="alert">
                    <p>Build history is unavailable.</p>
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() => void runs.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : runs.data?.runs.length === 0 ? (
                  <p className={cn("mt-2 text-subhead-regular text-fg-muted")}>
                    No builds recorded for this binding.
                  </p>
                ) : (
                  <div className={cn("mt-3 overflow-x-auto")}>
                    <table
                      className={cn(
                        "w-full text-left text-caption-1-regular text-fg",
                      )}
                    >
                      <caption className="sr-only">Recent CI builds</caption>
                      <thead>
                        <tr className={cn("border-b border-border")}>
                          <th scope="col" className={cn("px-3 py-2")}>
                            Run
                          </th>
                          <th scope="col" className={cn("px-3 py-2")}>
                            Commit / ref
                          </th>
                          <th scope="col" className={cn("px-3 py-2")}>
                            Status
                          </th>
                          <th scope="col" className={cn("px-3 py-2")}>
                            Evidence
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.data?.runs.map((run) => (
                          <tr
                            key={run.id}
                            className={cn("border-b border-border align-top")}
                          >
                            <td className={cn("px-3 py-3")}>
                              {run.runId}
                              {run.runAttempt ? ` / ${run.runAttempt}` : ""}
                              <br />
                              {new Intl.DateTimeFormat(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(run.createdAt))}
                            </td>
                            <td className={cn("px-3 py-3 break-all")}>
                              {run.commitSha.slice(0, 12)}
                              <br />
                              {run.ref}
                            </td>
                            <td className={cn("px-3 py-3")}>
                              {run.state.replaceAll("_", " ")}
                            </td>
                            <td className={cn("px-3 py-3 break-all")}>
                              Source {run.sourceId ?? "Pending"}
                              <br />
                              Job {run.jobId ?? "Pending"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : null}
          </SectionCard>
        </>
      )}
    </div>
  );
}
