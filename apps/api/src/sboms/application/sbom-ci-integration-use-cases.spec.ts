import { failure, success } from "../../common/domain/result";
import { SbomCiIntegrationUseCases } from "./sbom-ci-integration-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const credentialId = "00000000-0000-4000-8000-000000000002";
const bindingId = "00000000-0000-4000-8000-000000000003";
const connectorId = "00000000-0000-4000-8000-000000000004";
const sourceId = "00000000-0000-4000-8000-000000000005";
const idempotencyKey = "00000000-0000-4000-8000-000000000006";
const now = "2026-09-30T00:00:00.000Z";

const binding = Object.freeze({
  id: bindingId,
  connectorId,
  connectionRevision: 1,
  credentialRevision: 1,
  organizationId,
  productId: "00000000-0000-4000-8000-000000000007",
  releaseId: "00000000-0000-4000-8000-000000000008",
  credentialId,
  provider: "github_actions" as const,
  providerHost: "github.com",
  repositoryOwner: "cra-sentinel",
  repositoryName: "firmware",
  repositoryId: "12345",
  providerInstallationId: "67890",
  projectKey: null,
  pipelineDefinitionId: null,
  allowedRef: "refs/heads/main",
  status: "active" as const,
  version: 1,
  createdAt: now,
  updatedAt: now,
});

const uploadInput = Object.freeze({
  bindingId,
  runId: "987654321",
  runAttempt: "1",
  fileName: "firmware.cdx.json",
  mediaType: "application/vnd.cyclonedx+json" as const,
  byteSize: 1024,
  sha256: "b".repeat(64),
  declaredFormat: "cyclonedx" as const,
  idempotencyKey,
});
const bindingInput = Object.freeze({
  connectorId,
  productId: binding.productId,
  releaseId: binding.releaseId,
  credentialId,
  provider: binding.provider,
  providerHost: binding.providerHost,
  repositoryOwner: binding.repositoryOwner,
  repositoryName: binding.repositoryName,
  repositoryId: binding.repositoryId,
  providerInstallationId: binding.providerInstallationId,
  allowedRef: binding.allowedRef,
  idempotencyKey,
});
const completionInput = Object.freeze({
  bindingId,
  runId: uploadInput.runId,
  runAttempt: uploadInput.runAttempt,
  idempotencyKey,
});

const verifiedRun = Object.freeze({
  provider: "github_actions" as const,
  providerHost: "github.com",
  repositoryId: binding.repositoryId,
  providerInstallationId: binding.providerInstallationId,
  runId: uploadInput.runId,
  runAttempt: "1",
  ref: binding.allowedRef,
  commitSha: "a".repeat(40),
  eventName: "push" as const,
  observedAt: now,
});

const reservation = Object.freeze({
  id: sourceId,
  organizationId,
  productId: binding.productId,
  releaseId: binding.releaseId,
  source: "ci_upload" as const,
  objectKey: `${organizationId}/${sourceId}/${"b".repeat(64)}`,
  filename: uploadInput.fileName,
  byteSize: uploadInput.byteSize,
  mediaType: uploadInput.mediaType,
  sha256: uploadInput.sha256,
  expiresAt: now,
  status: "upload_pending" as const,
  createdAt: now,
  completedAt: null,
});

function harness() {
  const repository = {
    upsertBinding: jest
      .fn()
      .mockResolvedValue({ outcome: "upserted", binding }),
    listBindings: jest.fn().mockResolvedValue([binding]),
    revokeBinding: jest.fn(),
    getBinding: jest.fn().mockResolvedValue(binding),
    listBuildRuns: jest.fn().mockResolvedValue([]),
    reserveBuildUpload: jest.fn().mockResolvedValue({
      outcome: "created",
      reservation,
      buildRunId: bindingId,
    }),
    getBuildSourceForCompletion: jest.fn(),
    rejectBuildIntegrity: jest.fn(),
    finalizeBuildUpload: jest.fn(),
    gateVerdict: jest.fn(),
  };
  const storage = {
    createSignedUpload: jest.fn().mockResolvedValue({
      uploadUrl: "https://storage.test/sbom",
      expiresAt: now,
    }),
    inspect: jest.fn(),
    createSignedDownload: jest.fn(),
  };
  const connection = {
    connectorId,
    provider: "github_actions" as const,
    config: {
      providerHost: "github.com" as const,
      appId: "111",
      installationId: "67890",
    },
    secret: "pem",
    connectionRevision: 1,
    credentialRevision: 1,
  };
  const connections = { load: jest.fn().mockResolvedValue(connection) };
  const verifier = {
    verifyRepository: jest.fn().mockResolvedValue({
      outcome: "verified",
      repositoryId: binding.repositoryId,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
    }),
    verifyRun: jest
      .fn()
      .mockResolvedValue({ outcome: "verified", run: verifiedRun }),
  };
  return {
    useCases: new SbomCiIntegrationUseCases(
      repository,
      storage,
      connections,
      verifier,
    ),
    repository,
    storage,
    connections,
    verifier,
  };
}

describe("SbomCiIntegrationUseCases", () => {
  it("requires an expected version before updating an owner binding", async () => {
    const { useCases, connections } = harness();
    expect(
      await useCases.upsertBinding({
        organizationId,
        actorId: credentialId,
        input: { ...bindingInput, expectedBindingId: bindingId },
      }),
    ).toEqual(failure({ code: "invalid_request" }));
    expect(connections.load).not.toHaveBeenCalled();
  });

  it.each(["not_found", "conflict", "idempotency_mismatch"] as const)(
    "preserves the repository %s result for an owner binding",
    async (outcome) => {
      const { useCases, repository } = harness();
      repository.upsertBinding.mockResolvedValue({ outcome });
      expect(
        await useCases.upsertBinding({
          organizationId,
          actorId: credentialId,
          input: bindingInput,
        }),
      ).toEqual(failure({ code: outcome }));
    },
  );

  it.each(["untrusted", "rate_limited", "revoked"] as const)(
    "fails owner binding verification for %s",
    async (outcome) => {
      const { useCases, repository, verifier } = harness();
      verifier.verifyRepository.mockResolvedValue({ outcome });
      expect(
        await useCases.upsertBinding({
          organizationId,
          actorId: credentialId,
          input: bindingInput,
        }),
      ).toEqual(
        failure({
          code:
            outcome === "untrusted"
              ? "invalid_request"
              : outcome === "rate_limited"
                ? "unavailable"
                : "not_found",
        }),
      );
      expect(repository.upsertBinding).not.toHaveBeenCalled();
    },
  );

  it("does not reveal bindings from a failed connector lookup", async () => {
    const { useCases, connections, verifier } = harness();
    connections.load.mockResolvedValue({
      connectorId,
      provider: "github_actions",
      config: {
        providerHost: "github.com",
        appId: "111",
        installationId: "another",
      },
      secret: "pem",
      connectionRevision: 1,
      credentialRevision: 1,
    });
    expect(
      await useCases.upsertBinding({
        organizationId,
        actorId: credentialId,
        input: bindingInput,
      }),
    ).toEqual(failure({ code: "not_found" }));
    expect(verifier.verifyRepository).not.toHaveBeenCalled();
  });

  it("lists and revokes only through organization-scoped repository calls", async () => {
    const { useCases, repository } = harness();
    repository.revokeBinding.mockResolvedValue({
      outcome: "revoked",
      binding: { ...binding, status: "revoked" },
    });
    expect(await useCases.listBindings({ organizationId })).toEqual(
      success({ bindings: [binding] }),
    );
    expect(repository.listBindings).toHaveBeenCalledWith(organizationId);
    const input = {
      expectedBindingId: bindingId,
      expectedVersion: 1,
      idempotencyKey,
      reason: "Access revoked",
    };
    expect(
      await useCases.revokeBinding({
        organizationId,
        actorId: credentialId,
        input,
      }),
    ).toMatchObject({ ok: true, value: { binding: { status: "revoked" } } });
    expect(repository.revokeBinding).toHaveBeenCalledWith(
      organizationId,
      credentialId,
      input,
    );
  });

  it("checks binding scope before listing bounded build runs", async () => {
    const { useCases, repository } = harness();
    repository.getBinding.mockResolvedValueOnce(null);
    expect(
      await useCases.listBuildRuns({ organizationId, bindingId, limit: 20 }),
    ).toEqual(failure({ code: "not_found" }));
    expect(repository.listBuildRuns).not.toHaveBeenCalled();
    expect(
      await useCases.listBuildRuns({ organizationId, bindingId, limit: 20 }),
    ).toEqual(success({ runs: [] }));
    expect(repository.listBuildRuns).toHaveBeenCalledWith(
      organizationId,
      bindingId,
      20,
    );
  });

  it("preserves revoke conflicts", async () => {
    const { useCases, repository } = harness();
    repository.revokeBinding.mockResolvedValue({ outcome: "conflict" });
    expect(
      await useCases.revokeBinding({
        organizationId,
        actorId: credentialId,
        input: {
          expectedBindingId: bindingId,
          expectedVersion: 1,
          idempotencyKey,
          reason: "Revoked",
        },
      }),
    ).toEqual(failure({ code: "conflict" }));
  });

  it.each([
    "listBindings",
    "listBuildRuns",
    "revokeBinding",
    "gateVerdict",
  ] as const)("returns unavailable when %s fails", async (method) => {
    const { useCases, repository } = harness();
    repository[method].mockRejectedValue(new Error("database offline"));
    const result =
      method === "listBindings"
        ? await useCases.listBindings({ organizationId })
        : method === "listBuildRuns"
          ? await useCases.listBuildRuns({
              organizationId,
              bindingId,
              limit: 20,
            })
          : method === "revokeBinding"
            ? await useCases.revokeBinding({
                organizationId,
                actorId: credentialId,
                input: {
                  expectedBindingId: bindingId,
                  expectedVersion: 1,
                  idempotencyKey,
                  reason: "Revoked",
                },
              })
            : await useCases.gate({
                organizationId,
                credentialId,
                input: completionInput,
              });
    expect(result).toEqual(failure({ code: "unavailable" }));
  });
  it("uses provider-confirmed repository labels for an owner binding", async () => {
    const { useCases, repository, verifier } = harness();
    const input = {
      connectorId,
      productId: binding.productId,
      releaseId: binding.releaseId,
      credentialId,
      provider: binding.provider,
      providerHost: binding.providerHost,
      repositoryOwner: "forged",
      repositoryName: "forged",
      repositoryId: binding.repositoryId,
      providerInstallationId: binding.providerInstallationId,
      allowedRef: binding.allowedRef,
      idempotencyKey,
    };
    await expect(
      useCases.upsertBinding({
        organizationId,
        actorId: credentialId,
        input,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(repository.upsertBinding).toHaveBeenCalledWith(
      organizationId,
      credentialId,
      expect.objectContaining({
        repositoryOwner: binding.repositoryOwner,
        repositoryName: binding.repositoryName,
        expectedConnectionRevision: 1,
        expectedCredentialRevision: 1,
      }),
    );
    verifier.verifyRepository.mockResolvedValue({
      outcome: "verified",
      repositoryId: "99999",
      repositoryOwner: "elsewhere",
      repositoryName: "other",
    });
    repository.upsertBinding.mockClear();
    await expect(
      useCases.upsertBinding({
        organizationId,
        actorId: credentialId,
        input,
      }),
    ).resolves.toEqual(failure({ code: "not_found" }));
    expect(repository.upsertBinding).not.toHaveBeenCalled();
  });

  it("accepts no client provider identity and reserves only after provider verification", async () => {
    const { useCases, repository, verifier } = harness();
    const result = await useCases.initializeBuildUpload({
      organizationId,
      credentialId,
      input: uploadInput,
      correlationId: bindingId,
    });
    expect(result).toMatchObject(success({ buildRunId: bindingId }));
    expect(verifier.verifyRun).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId }),
      binding,
      expect.objectContaining({ bindingId, runId: uploadInput.runId }),
    );
    expect(repository.reserveBuildUpload).toHaveBeenCalledWith(
      organizationId,
      credentialId,
      expect.objectContaining({
        bindingId,
        repositoryId: binding.repositoryId,
        ref: binding.allowedRef,
      }),
      uploadInput,
      bindingId,
    );
  });

  it("rejects a build from a different ref before reserving", async () => {
    const { useCases, repository, verifier } = harness();
    verifier.verifyRun.mockResolvedValue({
      outcome: "verified",
      run: { ...verifiedRun, ref: "refs/heads/other" },
    });
    await expect(
      useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).resolves.toEqual(failure({ code: "not_found" }));
    expect(repository.reserveBuildUpload).not.toHaveBeenCalled();
  });

  it("rejects tenant/credential substitution before a provider request", async () => {
    const { useCases, repository, verifier } = harness();
    await expect(
      useCases.initializeBuildUpload({
        organizationId,
        credentialId: "00000000-0000-4000-8000-000000000099",
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).resolves.toEqual(failure({ code: "not_found" }));
    expect(verifier.verifyRun).not.toHaveBeenCalled();
    expect(repository.reserveBuildUpload).not.toHaveBeenCalled();
  });

  it("fails closed when a connector was rotated after binding", async () => {
    const { useCases, connections, verifier } = harness();
    connections.load.mockResolvedValue({
      connectorId,
      provider: "github_actions",
      config: {
        providerHost: "github.com",
        appId: "111",
        installationId: "67890",
      },
      secret: "pem",
      connectionRevision: 2,
      credentialRevision: 1,
    });
    await expect(
      useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).resolves.toEqual(failure({ code: "not_found" }));
    expect(verifier.verifyRun).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: "untrusted", code: "invalid_request" },
    { outcome: "invalid_configuration", code: "invalid_request" },
    { outcome: "rate_limited", code: "unavailable" },
    { outcome: "unavailable", code: "unavailable" },
    { outcome: "revoked", code: "not_found" },
  ] as const)(
    "refuses provider run verification after $outcome",
    async ({ outcome, code }) => {
      const { useCases, repository, verifier } = harness();
      verifier.verifyRun.mockResolvedValue({ outcome });
      expect(
        await useCases.initializeBuildUpload({
          organizationId,
          credentialId,
          input: uploadInput,
          correlationId: bindingId,
        }),
      ).toEqual(failure({ code }));
      expect(repository.reserveBuildUpload).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["provider", "gitlab_ci"],
    ["providerHost", "evil.example"],
    ["repositoryId", "other"],
    ["runId", "other"],
    ["runAttempt", "2"],
    ["providerInstallationId", "other"],
  ] as const)(
    "rejects provider-confirmed %s mismatch",
    async (field, value) => {
      const { useCases, repository, verifier } = harness();
      verifier.verifyRun.mockResolvedValue({
        outcome: "verified",
        run: { ...verifiedRun, [field]: value },
      });
      expect(
        await useCases.initializeBuildUpload({
          organizationId,
          credentialId,
          input: uploadInput,
          correlationId: bindingId,
        }),
      ).toEqual(failure({ code: "not_found" }));
      expect(repository.reserveBuildUpload).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid provider metadata even when identity matches", async () => {
    const { useCases, repository, verifier } = harness();
    verifier.verifyRun.mockResolvedValue({
      outcome: "verified",
      run: { ...verifiedRun, commitSha: "bad" },
    });
    expect(
      await useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).toEqual(failure({ code: "invalid_request" }));
    expect(repository.reserveBuildUpload).not.toHaveBeenCalled();
  });

  it("refuses revoked bindings before contacting the provider", async () => {
    const { useCases, repository, verifier } = harness();
    repository.getBinding.mockResolvedValue({ ...binding, status: "revoked" });
    expect(
      await useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).toEqual(failure({ code: "not_found" }));
    expect(verifier.verifyRun).not.toHaveBeenCalled();
  });

  it.each(["conflict", "idempotency_mismatch"] as const)(
    "preserves atomic reservation %s",
    async (outcome) => {
      const { useCases, repository } = harness();
      repository.reserveBuildUpload.mockResolvedValue({ outcome });
      expect(
        await useCases.initializeBuildUpload({
          organizationId,
          credentialId,
          input: uploadInput,
          correlationId: bindingId,
        }),
      ).toEqual(failure({ code: outcome }));
    },
  );

  it("replays an existing upload without creating another source", async () => {
    const { useCases, repository, storage } = harness();
    repository.reserveBuildUpload.mockResolvedValue({
      outcome: "replayed",
      reservation,
      buildRunId: bindingId,
    });
    expect(
      await useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).toMatchObject({
      ok: true,
      value: { replayed: true, buildRunId: bindingId },
    });
    expect(storage.createSignedUpload).toHaveBeenCalledTimes(1);
    repository.reserveBuildUpload.mockResolvedValue({
      outcome: "replayed",
      reservation: { ...reservation, status: "verified", completedAt: now },
      buildRunId: bindingId,
    });
    expect(
      await useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).toMatchObject({ ok: true, value: { upload: null, replayed: true } });
    expect(storage.createSignedUpload).toHaveBeenCalledTimes(1);
  });

  it.each([
    { outcome: "created", completedAt: now },
    { outcome: "replayed", completedAt: null },
  ] as const)(
    "rejects inconsistent verified reservation with $outcome",
    async ({ outcome, completedAt }) => {
      const { useCases, repository, storage } = harness();
      repository.reserveBuildUpload.mockResolvedValue({
        outcome,
        reservation: { ...reservation, status: "verified", completedAt },
        buildRunId: bindingId,
      });
      expect(
        await useCases.initializeBuildUpload({
          organizationId,
          credentialId,
          input: uploadInput,
          correlationId: bindingId,
        }),
      ).toEqual(failure({ code: "conflict" }));
      expect(storage.createSignedUpload).not.toHaveBeenCalled();
    },
  );

  it("reports unavailable if signed storage upload cannot be issued", async () => {
    const { useCases, storage } = harness();
    storage.createSignedUpload.mockRejectedValue(new Error("storage offline"));
    expect(
      await useCases.initializeBuildUpload({
        organizationId,
        credentialId,
        input: uploadInput,
        correlationId: bindingId,
      }),
    ).toEqual(failure({ code: "unavailable" }));
  });

  it("inspects the authorized object before atomic completion", async () => {
    const { useCases, repository, storage } = harness();
    repository.getBuildSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation,
    });
    storage.inspect.mockResolvedValue({
      outcome: "verified",
      sha256: reservation.sha256,
      byteSize: reservation.byteSize,
      contentType: reservation.mediaType,
    });
    repository.finalizeBuildUpload.mockResolvedValue({
      outcome: "queued",
      buildRunId: bindingId,
      job: { id: sourceId, sourceId },
    });
    await expect(
      useCases.completeBuildUpload({
        organizationId,
        credentialId,
        sourceId,
        input: {
          bindingId,
          runId: uploadInput.runId,
          runAttempt: "1",
          idempotencyKey,
        },
        correlationId: bindingId,
      }),
    ).resolves.toMatchObject(
      success({ outcome: "queued", buildRunId: bindingId }),
    );
    expect(repository.finalizeBuildUpload).toHaveBeenCalledWith(
      organizationId,
      credentialId,
      expect.objectContaining({ repositoryId: binding.repositoryId }),
      sourceId,
      expect.objectContaining({ sha256: reservation.sha256 }),
      idempotencyKey,
      bindingId,
    );
  });

  it("rejects completion for a source outside the recorded build", async () => {
    const { useCases, repository, storage } = harness();
    repository.getBuildSourceForCompletion.mockResolvedValue(null);
    expect(
      await useCases.completeBuildUpload({
        organizationId,
        credentialId,
        sourceId,
        input: completionInput,
        correlationId: bindingId,
      }),
    ).toEqual(failure({ code: "not_found" }));
    expect(storage.inspect).not.toHaveBeenCalled();
  });

  it("does not enqueue processing when storage inspection is unavailable", async () => {
    const { useCases, repository, storage } = harness();
    repository.getBuildSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation,
    });
    storage.inspect.mockResolvedValue({ outcome: "unavailable" });
    expect(
      await useCases.completeBuildUpload({
        organizationId,
        credentialId,
        sourceId,
        input: completionInput,
        correlationId: bindingId,
      }),
    ).toEqual(failure({ code: "unavailable" }));
    expect(repository.finalizeBuildUpload).not.toHaveBeenCalled();
  });

  it.each([
    {
      inspection: { outcome: "missing" },
      code: "source_missing",
      rejectOutcome: "not_found",
      result: "not_found",
    },
    {
      inspection: {
        outcome: "mismatch",
        sha256: "c".repeat(64),
        byteSize: 100,
        contentType: "text/plain",
      },
      code: "content_hash_mismatch",
      rejectOutcome: "rejected",
      result: "conflict",
    },
  ] as const)(
    "records a $inspection.outcome object integrity failure atomically",
    async ({ inspection, code, rejectOutcome, result }) => {
      const { useCases, repository, storage } = harness();
      repository.getBuildSourceForCompletion.mockResolvedValue({
        outcome: "ready",
        source: reservation,
      });
      storage.inspect.mockResolvedValue(inspection);
      repository.rejectBuildIntegrity.mockResolvedValue(rejectOutcome);
      expect(
        await useCases.completeBuildUpload({
          organizationId,
          credentialId,
          sourceId,
          input: completionInput,
          correlationId: bindingId,
        }),
      ).toEqual(failure({ code: result }));
      expect(repository.rejectBuildIntegrity).toHaveBeenCalledWith(
        organizationId,
        credentialId,
        completionInput,
        sourceId,
        idempotencyKey,
        code,
        expect.objectContaining({
          sha256: "sha256" in inspection ? inspection.sha256 : null,
        }),
        bindingId,
      );
      expect(repository.finalizeBuildUpload).not.toHaveBeenCalled();
    },
  );

  it("replays a completed source without re-inspecting an expired signed object", async () => {
    const { useCases, repository, storage } = harness();
    repository.getBuildSourceForCompletion.mockResolvedValue({
      outcome: "replayed",
      source: reservation,
    });
    repository.finalizeBuildUpload.mockResolvedValue({
      outcome: "replayed",
      job: { id: sourceId, sourceId },
      buildRunId: bindingId,
    });
    expect(
      await useCases.completeBuildUpload({
        organizationId,
        credentialId,
        sourceId,
        input: completionInput,
        correlationId: bindingId,
      }),
    ).toMatchObject({ ok: true, value: { outcome: "replayed" } });
    expect(storage.inspect).not.toHaveBeenCalled();
  });

  it("preserves atomic finalization conflicts and storage failures", async () => {
    const { useCases, repository, storage } = harness();
    repository.getBuildSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation,
    });
    storage.inspect.mockResolvedValue({
      outcome: "verified",
      sha256: reservation.sha256,
      byteSize: reservation.byteSize,
      contentType: reservation.mediaType,
    });
    repository.finalizeBuildUpload
      .mockResolvedValueOnce({ outcome: "idempotency_mismatch" })
      .mockRejectedValueOnce(new Error("database offline"));
    const command = {
      organizationId,
      credentialId,
      sourceId,
      input: completionInput,
      correlationId: bindingId,
    };
    expect(await useCases.completeBuildUpload(command)).toEqual(
      failure({ code: "idempotency_mismatch" }),
    );
    expect(await useCases.completeBuildUpload(command)).toEqual(
      failure({ code: "unavailable" }),
    );
  });

  it("returns a status-only verdict", async () => {
    const { useCases, repository } = harness();
    repository.gateVerdict.mockResolvedValue({
      policy: "unconfigured",
      state: "policy_not_configured",
      buildRunId: bindingId,
      sourceId,
      jobId: null,
      correlationId: `${bindingId}:${uploadInput.runId}:1`,
      message: "No passing policy is configured.",
      checkedAt: now,
    });
    expect(
      await useCases.gate({
        organizationId,
        credentialId,
        input: { bindingId, runId: uploadInput.runId, runAttempt: "1" },
      }),
    ).toMatchObject({
      ok: true,
      value: { verdict: { state: "policy_not_configured" } },
    });
  });
});
