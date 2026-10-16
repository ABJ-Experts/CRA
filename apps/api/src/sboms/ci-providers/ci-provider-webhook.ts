import { createHash } from "node:crypto";

import type { CiProviderReleaseBinding } from "@repo/contracts/sboms";
import { z } from "zod";

import type {
  CiConnectionReader,
  CiProviderVerifierPort,
  SbomCiIntegrationRepository,
} from "../application/sbom-ci-integration.port";
import {
  providerDeliveryIdentity,
  verifyGithubWebhook,
  verifyGitlabWebhook,
} from "./webhook-verification";

type InboundProvider = "github_actions" | "gitlab_ci";
type WebhookHeaders = Readonly<Record<string, string | string[] | undefined>>;
type Secret = Readonly<{
  mode: "github" | "signed" | "legacy";
  secret: string;
}>;

export interface CiWebhookSecretReader {
  load(
    provider: InboundProvider,
    connectorId: string,
  ): Secret | null | Promise<Secret | null>;
}

export type CiWebhookLedgerInput = Readonly<{
  bindingId: string;
  provider: InboundProvider;
  deliveryId: string;
  bodySha256: string;
  runId: string;
  runAttempt: string;
}>;

export interface CiWebhookEventLedger {
  record(
    organizationId: string,
    input: CiWebhookLedgerInput,
  ): Promise<
    Readonly<{
      outcome:
        "recorded" | "replayed" | "conflict" | "not_found" | "invalid_request";
      eventId?: string;
    }>
  >;
}

export type CiWebhookOutcome =
  | "recorded"
  | "replayed"
  | "unauthorized"
  | "not_found"
  | "invalid_request"
  | "untrusted"
  | "conflict"
  | "unavailable";

type ReceiveInput = Readonly<{
  provider: InboundProvider;
  organizationId: string;
  bindingId: string;
  rawBody: Buffer;
  headers: WebhookHeaders;
}>;

const MAX_WEBHOOK_BYTES = 1_048_576;
const githubEvent = z.object({
  action: z.literal("completed"),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ id: z.number().int().positive() }),
  workflow_run: z.object({
    id: z.number().int().positive(),
    run_attempt: z.number().int().positive(),
  }),
});
const gitlabEvent = z.object({
  object_kind: z.literal("pipeline"),
  project: z.object({ id: z.number().int().positive() }),
  object_attributes: z.object({ id: z.number().int().positive() }),
});

const header = (headers: WebhookHeaders, name: string): string | null => {
  const value = headers[name];
  return typeof value === "string" ? value : null;
};

/** Webhooks are notifications only. Provider API and the binding decide authority. */
export class CiProviderWebhookUseCases {
  constructor(
    private readonly bindings: Pick<SbomCiIntegrationRepository, "getBinding">,
    private readonly connections: CiConnectionReader,
    private readonly verifier: CiProviderVerifierPort,
    private readonly secrets: CiWebhookSecretReader,
    private readonly ledger: CiWebhookEventLedger,
  ) {}

  async receive(
    input: ReceiveInput,
  ): Promise<Readonly<{ outcome: CiWebhookOutcome }>> {
    if (
      !Buffer.isBuffer(input.rawBody) ||
      input.rawBody.byteLength < 1 ||
      input.rawBody.byteLength > MAX_WEBHOOK_BYTES
    )
      return { outcome: "invalid_request" };
    try {
      const binding = await this.bindings.getBinding(
        input.organizationId,
        input.bindingId,
      );
      if (
        !binding ||
        binding.status !== "active" ||
        binding.provider !== input.provider
      )
        return { outcome: "unauthorized" };
      const connection = await this.connections.load(
        input.organizationId,
        binding.connectorId,
      );
      if (!connectionMatches(binding, connection))
        return { outcome: "unauthorized" };
      const secret = await this.secrets.load(
        input.provider,
        binding.connectorId,
      );
      if (!secret || !this.authentic(input, secret))
        return { outcome: "unauthorized" };
      const deliveryId = delivery(input);
      if (
        !deliveryId ||
        !providerDeliveryIdentity(
          input.provider,
          binding.providerHost,
          deliveryId,
        )
      )
        return { outcome: "unauthorized" };
      const reference = parseReference(input, binding);
      if (!reference) return { outcome: "untrusted" };
      const verified = await this.verifier.verifyRun(connection, binding, {
        bindingId: binding.id,
        ...reference,
      });
      if (
        verified.outcome === "rate_limited" ||
        verified.outcome === "unavailable"
      )
        return { outcome: "unavailable" };
      if (verified.outcome === "revoked" || verified.outcome === "not_found")
        return { outcome: "not_found" };
      if (
        verified.outcome !== "verified" ||
        !runMatches(binding, reference, verified.run)
      )
        return { outcome: "untrusted" };
      const recorded = await this.ledger.record(input.organizationId, {
        bindingId: input.bindingId,
        provider: input.provider,
        deliveryId,
        bodySha256: createHash("sha256").update(input.rawBody).digest("hex"),
        runId: reference.runId,
        runAttempt: reference.runAttempt,
      });
      return { outcome: recorded.outcome };
    } catch {
      return { outcome: "unavailable" };
    }
  }

  private authentic(input: ReceiveInput, secret: Secret): boolean {
    if (input.provider === "github_actions")
      return (
        secret.mode === "github" &&
        verifyGithubWebhook(input.rawBody, input.headers, secret.secret)
      );
    return (
      secret.mode !== "github" &&
      verifyGitlabWebhook(
        input.rawBody,
        input.headers,
        secret.secret,
        secret.mode,
      )
    );
  }
}

function delivery(input: ReceiveInput): string | null {
  return input.provider === "github_actions"
    ? header(input.headers, "x-github-delivery")
    : (header(input.headers, "webhook-id") ??
        header(input.headers, "idempotency-key") ??
        header(input.headers, "x-gitlab-event-uuid"));
}

function parseReference(
  input: ReceiveInput,
  binding: CiProviderReleaseBinding,
): Readonly<{ runId: string; runAttempt: string }> | null {
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString("utf8"));
  } catch {
    return null;
  }
  if (input.provider === "github_actions") {
    const event = githubEvent.safeParse(payload);
    if (
      !event.success ||
      String(event.data.installation.id) !== binding.providerInstallationId ||
      String(event.data.repository.id) !== binding.repositoryId
    )
      return null;
    return {
      runId: String(event.data.workflow_run.id),
      runAttempt: String(event.data.workflow_run.run_attempt),
    };
  }
  const event = gitlabEvent.safeParse(payload);
  if (!event.success || String(event.data.project.id) !== binding.repositoryId)
    return null;
  return { runId: String(event.data.object_attributes.id), runAttempt: "1" };
}

function connectionMatches(
  binding: CiProviderReleaseBinding,
  connection: Awaited<ReturnType<CiConnectionReader["load"]>>,
): boolean {
  if (
    connection.provider !== binding.provider ||
    connection.config.providerHost !== binding.providerHost ||
    connection.connectionRevision !== binding.connectionRevision ||
    connection.credentialRevision !== binding.credentialRevision
  )
    return false;
  if (connection.provider === "github_actions")
    return connection.config.installationId === binding.providerInstallationId;
  return connection.config.projectId === binding.repositoryId;
}

function runMatches(
  binding: CiProviderReleaseBinding,
  reference: Readonly<{ runId: string; runAttempt: string }>,
  run: Extract<
    Awaited<ReturnType<CiProviderVerifierPort["verifyRun"]>>,
    { outcome: "verified" }
  >["run"],
): boolean {
  return (
    run.provider === binding.provider &&
    run.providerHost === binding.providerHost &&
    run.repositoryId === binding.repositoryId &&
    run.runId === reference.runId &&
    run.runAttempt === reference.runAttempt &&
    run.ref === binding.allowedRef &&
    (run.providerInstallationId ?? null) === binding.providerInstallationId &&
    (run.projectKey ?? null) === binding.projectKey &&
    (run.pipelineDefinitionId ?? null) === binding.pipelineDefinitionId
  );
}
