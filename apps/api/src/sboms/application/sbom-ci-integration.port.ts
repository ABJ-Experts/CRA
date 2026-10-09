import type {
  CiBuildGateVerdict,
  CiBuildMetadata,
  CiBuildReference,
  CiBuildRunSummary,
  CiProviderReleaseBinding,
  CiInitializeSbomWithBuildInput,
  RevokeCiProviderReleaseBindingInput,
  UpsertCiProviderReleaseBindingInput,
} from "@repo/contracts/sboms";

import type {
  SbomJob,
  SbomReservation,
  SbomSource,
} from "./sbom-intake-use-cases";
import type { CiConnectorConnection } from "../../connectors/application/ci-connector-credential-reader";

export const SBOM_CI_INTEGRATION_REPOSITORY = Symbol(
  "SBOM_CI_INTEGRATION_REPOSITORY",
);

export type SbomCiIntegrationErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "idempotency_mismatch"
  | "unavailable";

export type CiAtomicError = Readonly<{
  outcome:
    "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
}>;

export interface CiConnectionReader {
  load(
    organizationId: string,
    connectorId: string,
  ): Promise<CiConnectorConnection>;
}

type VerificationFailure = Readonly<{
  outcome:
    | "untrusted"
    | "not_found"
    | "revoked"
    | "rate_limited"
    | "unavailable"
    | "invalid_configuration";
  retryAfterSeconds?: number;
}>;

export interface CiProviderVerifierPort {
  verifyRepository(
    connection: CiConnectorConnection,
    binding: UpsertCiProviderReleaseBindingInput,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        repositoryId: string;
        repositoryOwner: string;
        repositoryName: string;
      }>
    | VerificationFailure
  >;
  verifyRun(
    connection: CiConnectorConnection,
    binding: CiProviderReleaseBinding,
    reference: CiBuildReference,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        run: Readonly<{
          provider: CiBuildMetadata["provider"];
          providerHost: string;
          repositoryId: string;
          providerInstallationId?: string;
          projectKey?: string;
          pipelineDefinitionId?: string;
          runId: string;
          runAttempt: string;
          commitSha: string;
          ref: string;
          eventName: CiBuildMetadata["eventName"];
          observedAt: string;
        }>;
      }>
    | VerificationFailure
  >;
}

export interface SbomCiIntegrationRepository {
  upsertBinding(
    organizationId: string,
    actorId: string,
    input: UpsertCiProviderReleaseBindingInput &
      Readonly<{
        expectedConnectionRevision: number;
        expectedCredentialRevision: number;
      }>,
  ): Promise<
    | Readonly<{
        outcome: "upserted" | "replayed";
        binding: CiProviderReleaseBinding;
      }>
    | Readonly<{
        outcome: "not_found" | "conflict" | "idempotency_mismatch";
      }>
  >;
  listBindings(
    organizationId: string,
  ): Promise<readonly CiProviderReleaseBinding[]>;
  revokeBinding(
    organizationId: string,
    actorId: string,
    input: RevokeCiProviderReleaseBindingInput,
  ): Promise<
    | Readonly<{
        outcome: "revoked" | "replayed";
        binding: CiProviderReleaseBinding;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "idempotency_mismatch" }>
  >;
  getBinding(
    organizationId: string,
    bindingId: string,
  ): Promise<CiProviderReleaseBinding | null>;
  listBuildRuns(
    organizationId: string,
    bindingId: string,
    limit: number,
  ): Promise<readonly CiBuildRunSummary[]>;
  reserveBuildUpload(
    organizationId: string,
    credentialId: string,
    verified: CiBuildMetadata,
    upload: CiInitializeSbomWithBuildInput,
    correlationId: string,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        reservation: SbomReservation;
        buildRunId: string;
      }>
    | CiAtomicError
  >;
  getBuildSourceForCompletion(
    organizationId: string,
    credentialId: string,
    reference: CiBuildReference,
    sourceId: string,
  ): Promise<Readonly<{
    outcome: "ready" | "replayed";
    source: SbomSource;
  }> | null>;
  rejectBuildIntegrity(
    organizationId: string,
    credentialId: string,
    reference: CiBuildReference,
    sourceId: string,
    idempotencyKey: string,
    code: "source_missing" | "content_hash_mismatch",
    actual: Readonly<{
      sha256: string | null;
      byteSize: number | null;
      contentType: string | null;
    }>,
    correlationId: string,
  ): Promise<"rejected" | "replayed" | "not_found" | "conflict">;
  finalizeBuildUpload(
    organizationId: string,
    credentialId: string,
    verified: CiBuildMetadata,
    sourceId: string,
    inspection: Readonly<{
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<
    | Readonly<{
        outcome: "queued" | "replayed" | "deduplicated";
        job: SbomJob;
        buildRunId: string;
      }>
    | CiAtomicError
  >;
  gateVerdict(
    organizationId: string,
    credentialId: string,
    input: CiBuildReference,
  ): Promise<CiBuildGateVerdict>;
}
