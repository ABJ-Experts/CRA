import { ciBuildMetadataSchema } from "@repo/contracts/sboms";
import type {
  CiBuildGateVerdict,
  CiBuildParams,
  CiCompleteSbomWithBuildInput,
  CiInitializeSbomWithBuildInput,
  CiProviderReleaseBinding,
  RevokeCiProviderReleaseBindingInput,
  UpsertCiProviderReleaseBindingInput,
} from "@repo/contracts/sboms";

import type { CiConnectorConnection } from "../../connectors/application/ci-connector-credential-reader";
import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import type { SbomStoragePort } from "./sbom-intake-use-cases";
import type { SbomJob, SbomReservation } from "./sbom-intake-use-cases";
import type {
  CiConnectionReader,
  CiProviderVerifierPort,
  SbomCiIntegrationErrorCode,
  SbomCiIntegrationRepository,
} from "./sbom-ci-integration.port";

export type SbomCiIntegrationError = Readonly<{
  code: SbomCiIntegrationErrorCode;
}>;

export type CiBuildUploadInitialization = Readonly<{
  reservation: SbomReservation;
  upload: Readonly<{ uploadUrl: string; expiresAt: string }> | null;
  replayed: boolean;
  buildRunId: string;
}>;
export type CiBuildUploadCompletion = Readonly<{
  job: SbomJob;
  outcome: "queued" | "replayed" | "deduplicated";
  buildRunId: string;
}>;

type Scope = Readonly<{ organizationId: string; credentialId: string }>;

/** CI metadata is advisory until it has been read back from its provider. */
export class SbomCiIntegrationUseCases {
  constructor(
    private readonly repository: SbomCiIntegrationRepository,
    private readonly storage: SbomStoragePort,
    private readonly connections: CiConnectionReader,
    private readonly verifier: CiProviderVerifierPort,
  ) {}

  async upsertBinding(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: UpsertCiProviderReleaseBindingInput;
    }>,
  ) {
    try {
      if (command.input.expectedBindingId && !command.input.expectedVersion)
        return failure({ code: "invalid_request" as const });
      const connection = await this.connections.load(
        command.organizationId,
        command.input.connectorId,
      );
      if (!connectionMatchesInput(connection, command.input))
        return failure({ code: "not_found" as const });
      const verified = await this.verifier.verifyRepository(
        connection,
        command.input,
      );
      if (verified.outcome !== "verified")
        return failure({ code: verificationError(verified.outcome) });
      if (verified.repositoryId !== command.input.repositoryId)
        return failure({ code: "not_found" as const });
      const input = {
        ...command.input,
        repositoryOwner: verified.repositoryOwner,
        repositoryName: verified.repositoryName,
        expectedConnectionRevision: connection.connectionRevision,
        expectedCredentialRevision: connection.credentialRevision,
      };
      const result = await this.repository.upsertBinding(
        command.organizationId,
        command.actorId,
        input,
      );
      if ("binding" in result)
        return success(Object.freeze({ binding: result.binding }));
      return failure({ code: result.outcome });
    } catch {
      return failure({ code: "unavailable" as const });
    }
  }

  async listBindings(command: Readonly<{ organizationId: string }>) {
    try {
      const bindings = await this.repository.listBindings(
        command.organizationId,
      );
      return success(Object.freeze({ bindings }));
    } catch {
      return failure({ code: "unavailable" as const });
    }
  }

  async listBuildRuns(
    command: Readonly<{
      organizationId: string;
      bindingId: string;
      limit: number;
    }>,
  ) {
    try {
      const binding = await this.repository.getBinding(
        command.organizationId,
        command.bindingId,
      );
      if (!binding) return failure({ code: "not_found" as const });
      const runs = await this.repository.listBuildRuns(
        command.organizationId,
        command.bindingId,
        command.limit,
      );
      return success(Object.freeze({ runs }));
    } catch {
      return failure({ code: "unavailable" as const });
    }
  }

  async revokeBinding(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: RevokeCiProviderReleaseBindingInput;
    }>,
  ) {
    try {
      const result = await this.repository.revokeBinding(
        command.organizationId,
        command.actorId,
        command.input,
      );
      if ("binding" in result)
        return success(Object.freeze({ binding: result.binding }));
      return failure({ code: result.outcome });
    } catch {
      return failure({ code: "unavailable" as const });
    }
  }

  async initializeBuildUpload(
    command: Scope &
      Readonly<{
        input: CiInitializeSbomWithBuildInput;
        correlationId: string;
      }>,
  ): Promise<Result<CiBuildUploadInitialization, SbomCiIntegrationError>> {
    try {
      const verified = await this.verifiedBuild(command, command.input);
      if (!verified.ok) return verified;
      const reserved = await this.repository.reserveBuildUpload(
        command.organizationId,
        command.credentialId,
        verified.value,
        command.input,
        command.correlationId,
      );
      if (!("reservation" in reserved))
        return failure({ code: reserved.outcome });
      if (reserved.reservation.status === "verified") {
        if (
          reserved.outcome !== "replayed" ||
          !reserved.reservation.completedAt
        )
          return failure({ code: "conflict" as const });
        return success(
          Object.freeze({
            reservation: reserved.reservation,
            upload: null,
            replayed: true,
            buildRunId: reserved.buildRunId,
          }),
        );
      }
      const upload = await this.storage.createSignedUpload({
        objectKey: reserved.reservation.objectKey,
        contentType: reserved.reservation.mediaType,
        byteSize: reserved.reservation.byteSize,
      });
      return success(
        Object.freeze({
          reservation: reserved.reservation,
          upload,
          replayed: reserved.outcome === "replayed",
          buildRunId: reserved.buildRunId,
        }),
      );
    } catch {
      return failure({ code: "unavailable" as const });
    }
  }

  async completeBuildUpload(
    command: Scope &
      Readonly<{
        sourceId: string;
        input: CiCompleteSbomWithBuildInput;
        correlationId: string;
      }>,
  ): Promise<Result<CiBuildUploadCompletion, SbomCiIntegrationError>> {
    try {
      const verified = await this.verifiedBuild(command, command.input);
      if (!verified.ok) return verified;
      const authorized = await this.repository.getBuildSourceForCompletion(
        command.organizationId,
        command.credentialId,
        command.input,
        command.sourceId,
      );
      if (!authorized) return failure({ code: "not_found" as const });
      const source = authorized.source;
      const inspection =
        authorized.outcome === "replayed"
          ? {
              outcome: "verified" as const,
              sha256: source.sha256,
              byteSize: source.byteSize,
              contentType: source.mediaType,
            }
          : await this.storage.inspect({
              objectKey: source.objectKey,
              sha256: source.sha256,
              byteSize: source.byteSize,
              contentType: source.mediaType,
            });
      if (inspection.outcome !== "verified") {
        if (inspection.outcome === "unavailable")
          return failure({ code: "unavailable" as const });
        const code =
          inspection.outcome === "missing"
            ? ("source_missing" as const)
            : ("content_hash_mismatch" as const);
        const rejected = await this.repository.rejectBuildIntegrity(
          command.organizationId,
          command.credentialId,
          command.input,
          command.sourceId,
          command.input.idempotencyKey,
          code,
          {
            sha256: "sha256" in inspection ? inspection.sha256 : null,
            byteSize: "byteSize" in inspection ? inspection.byteSize : null,
            contentType:
              "contentType" in inspection ? inspection.contentType : null,
          },
          command.correlationId,
        );
        return failure({
          code:
            rejected === "not_found"
              ? ("not_found" as const)
              : ("conflict" as const),
        });
      }
      const completed = await this.repository.finalizeBuildUpload(
        command.organizationId,
        command.credentialId,
        verified.value,
        command.sourceId,
        inspection,
        command.input.idempotencyKey,
        command.correlationId,
      );
      if (!("job" in completed)) return failure({ code: completed.outcome });
      return success(
        Object.freeze({
          job: completed.job,
          outcome: completed.outcome,
          buildRunId: completed.buildRunId,
        }),
      );
    } catch {
      return failure({ code: "unavailable" as const });
    }
  }

  async gate(
    command: Scope & Readonly<{ input: CiBuildParams }>,
  ): Promise<
    Result<Readonly<{ verdict: CiBuildGateVerdict }>, SbomCiIntegrationError>
  > {
    try {
      return success(
        Object.freeze({
          verdict: await this.repository.gateVerdict(
            command.organizationId,
            command.credentialId,
            command.input,
          ),
        }),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  private async verifiedBuild(
    scope: Scope,
    reference: CiBuildParams,
  ): Promise<
    Result<
      ReturnType<typeof ciBuildMetadataSchema.parse>,
      SbomCiIntegrationError
    >
  > {
    const binding = await this.repository.getBinding(
      scope.organizationId,
      reference.bindingId,
    );
    if (
      !binding ||
      binding.status !== "active" ||
      binding.credentialId !== scope.credentialId
    )
      return failure({ code: "not_found" });
    const connection = await this.connections.load(
      scope.organizationId,
      binding.connectorId,
    );
    if (!connectionMatchesBinding(connection, binding))
      return failure({ code: "not_found" });
    const verified = await this.verifier.verifyRun(
      connection,
      binding,
      reference,
    );
    if (verified.outcome !== "verified")
      return failure({ code: verificationError(verified.outcome) });
    const run = verified.run;
    if (
      run.provider !== binding.provider ||
      run.providerHost !== binding.providerHost ||
      run.repositoryId !== binding.repositoryId ||
      run.ref !== binding.allowedRef ||
      run.runId !== reference.runId ||
      run.runAttempt !== reference.runAttempt ||
      (run.providerInstallationId ?? null) !== binding.providerInstallationId ||
      (run.projectKey ?? null) !== binding.projectKey ||
      (run.pipelineDefinitionId ?? null) !== binding.pipelineDefinitionId
    )
      return failure({ code: "not_found" });
    const parsed = ciBuildMetadataSchema.safeParse({
      ...run,
      bindingId: binding.id,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
    });
    return parsed.success
      ? success(parsed.data)
      : failure({ code: "invalid_request" });
  }
}

type ConnectionIdentity = Pick<
  UpsertCiProviderReleaseBindingInput,
  | "provider"
  | "providerHost"
  | "repositoryId"
  | "providerInstallationId"
  | "projectKey"
>;

function connectionMatchesInput(
  connection: CiConnectorConnection,
  input: ConnectionIdentity,
): boolean {
  if (
    connection.provider !== input.provider ||
    connection.config.providerHost !== input.providerHost
  )
    return false;
  switch (connection.provider) {
    case "github_actions":
      return connection.config.installationId === input.providerInstallationId;
    case "gitlab_ci":
      return connection.config.projectId === input.repositoryId;
    case "azure_devops":
      return connection.config.projectId === input.projectKey;
  }
}

function connectionMatchesBinding(
  connection: CiConnectorConnection,
  binding: CiProviderReleaseBinding,
): boolean {
  return (
    connection.connectionRevision === binding.connectionRevision &&
    connection.credentialRevision === binding.credentialRevision &&
    connectionMatchesInput(connection, {
      provider: binding.provider,
      providerHost: binding.providerHost,
      repositoryId: binding.repositoryId,
      providerInstallationId: binding.providerInstallationId ?? undefined,
      projectKey: binding.projectKey ?? undefined,
    })
  );
}

function verificationError(
  outcome: Exclude<
    Awaited<ReturnType<CiProviderVerifierPort["verifyRun"]>>["outcome"],
    "verified"
  >,
): SbomCiIntegrationErrorCode {
  if (outcome === "rate_limited" || outcome === "unavailable")
    return "unavailable";
  if (outcome === "untrusted" || outcome === "invalid_configuration")
    return "invalid_request";
  return "not_found";
}
