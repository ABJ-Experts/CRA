import { describe, expect, it } from "vitest";

import {
  ciBuildGateVerdictSchema,
  ciInitializeSbomWithBuildInputSchema,
  upsertCiProviderReleaseBindingInputSchema,
} from "./sbom-ci-integration.schema.js";

const ids = {
  bindingId: "11111111-1111-4111-8111-111111111111",
  connectorId: "88888888-8888-4888-8888-888888888888",
  productId: "22222222-2222-4222-8222-222222222222",
  releaseId: "33333333-3333-4333-8333-333333333333",
  credentialId: "44444444-4444-4444-8444-444444444444",
  sourceId: "55555555-5555-4555-8555-555555555555",
  jobId: "66666666-6666-4666-8666-666666666666",
  idempotencyKey: "77777777-7777-4777-8777-777777777777",
};

const repository = {
  provider: "github_actions" as const,
  providerHost: "github.com",
  repositoryOwner: "cra-sentinel",
  repositoryName: "firmware",
  repositoryId: "R_kgDO-example",
  allowedRef: "refs/heads/main",
};

const build = {
  bindingId: ids.bindingId,
  runId: "987654321",
  runAttempt: "1",
};

describe("SBOM CI integration contracts", () => {
  it("requires GitHub Actions bindings to carry GitHub App installation identity", () => {
    expect(
      upsertCiProviderReleaseBindingInputSchema.safeParse({
        ...repository,
        connectorId: ids.connectorId,
        productId: ids.productId,
        releaseId: ids.releaseId,
        credentialId: ids.credentialId,
        idempotencyKey: ids.idempotencyKey,
      }).success,
    ).toBe(false);

    expect(
      upsertCiProviderReleaseBindingInputSchema.parse({
        ...repository,
        connectorId: ids.connectorId,
        providerInstallationId: "12345678",
        productId: ids.productId,
        releaseId: ids.releaseId,
        credentialId: ids.credentialId,
        idempotencyKey: ids.idempotencyKey,
      }).providerInstallationId,
    ).toBe("12345678");
  });

  it("rejects installation identity on non-GitHub providers", () => {
    expect(
      upsertCiProviderReleaseBindingInputSchema.safeParse({
        ...repository,
        connectorId: ids.connectorId,
        provider: "gitlab_ci",
        providerHost: "gitlab.example.com",
        providerInstallationId: "not-gitlab",
        productId: ids.productId,
        releaseId: ids.releaseId,
        credentialId: ids.credentialId,
        idempotencyKey: ids.idempotencyKey,
      }).success,
    ).toBe(false);
  });

  it("accepts only a binding and run reference from the CI caller", () => {
    expect(
      ciInitializeSbomWithBuildInputSchema.parse({
        ...build,
        fileName: "firmware.cdx.json",
        mediaType: "application/vnd.cyclonedx+json",
        byteSize: 4096,
        sha256: "b".repeat(64),
        declaredFormat: "cyclonedx",
        declaredSpecVersion: "1.6",
        idempotencyKey: ids.idempotencyKey,
      }),
    ).toMatchObject({
      bindingId: ids.bindingId,
      runId: "987654321",
    });

    for (const input of [
      { ...build, providerHost: "github.com" },
      { ...build, trustedEvent: true },
      { ...build, repositoryId: "other" },
      { ...build, supersedesSourceId: ids.sourceId },
      { ...build, mediaType: "image/png" },
      { ...build, unknown: true },
    ]) {
      expect(
        ciInitializeSbomWithBuildInputSchema.safeParse({
          ...input,
          fileName: "firmware.cdx.json",
          byteSize: 4096,
          sha256: "b".repeat(64),
          idempotencyKey: ids.idempotencyKey,
        }).success,
      ).toBe(false);
    }
  });

  it("allows pending and error gates without pretending the build passed", () => {
    for (const state of [
      "pending",
      "error",
      "policy_not_configured",
    ] as const) {
      expect(
        ciBuildGateVerdictSchema.parse({
          policy: "unconfigured",
          state,
          buildRunId: ids.bindingId,
          sourceId: null,
          jobId: null,
          correlationId: "github_actions:987654321",
          message: "SBOM intake is not complete.",
          checkedAt: "2026-09-30T00:00:00.000Z",
        }).state,
      ).toBe(state);
    }
  });

  it("cannot represent an approved gate before policy ownership exists", () => {
    const approved = {
      policy: "unconfigured" as const,
      state: "approved" as const,
      buildRunId: ids.bindingId,
      sourceId: ids.sourceId,
      jobId: ids.jobId,
      correlationId: "github_actions:987654321",
      message: "SBOM intake completed for this build.",
      checkedAt: "2026-09-30T00:00:00.000Z",
    };

    expect(ciBuildGateVerdictSchema.safeParse(approved).success).toBe(false);
  });
});
