import { CRA_SENTINEL_BRANDING } from "@repo/contracts/organizations";

import {
  BrandingProviderError,
  BrandingUseCases,
  type BrandingRepository,
  type BrandingRequestIdentityPort,
  type BrandingScannerPort,
  type BrandingScannerPolicyPort,
  type BrandingStoragePort,
  type LogoProcessorPort,
} from "./branding-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const idempotencyKey = "00000000-0000-4000-8000-000000000004";

function publishedBranding() {
  return Object.freeze({
    source: "published" as const,
    displayName: "Acme",
    footerText: "Acme footer",
    contactText: "support@acme.test",
    palette: Object.freeze({
      primary: "#000000",
      primaryText: "#FFFFFF" as const,
      secondary: "#FFFFFF",
      secondaryText: "#000000" as const,
    }),
    logo: null,
    version: 1,
    publishedAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  });
}

function draftBranding() {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000005",
    displayName: "Acme",
    palette: Object.freeze({
      primary: "#000000",
      secondary: "#FFFFFF",
    }),
    footerText: "Acme footer",
    contactText: "support@acme.test",
    logoAsset: Object.freeze({
      status: "none" as const,
      asset: null,
    }),
    version: 1,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    createdBy: actorId,
    updatedBy: actorId,
  });
}

function harness(
  overrides: Partial<{
    repository: Partial<BrandingRepository>;
    processor: Partial<LogoProcessorPort>;
    storage: Partial<BrandingStoragePort>;
    scanner: Partial<BrandingScannerPort>;
  }> = {},
) {
  const repository: BrandingRepository = {
    getResolved: jest.fn().mockResolvedValue({
      outcome: "found",
      branding: publishedBranding(),
    }),
    getDraft: jest.fn().mockResolvedValue({
      outcome: "found",
      branding: publishedBranding(),
    }),
    getRenderableLogo: jest.fn().mockResolvedValue({
      outcome: "found",
      objectKey: "private/object.webp",
      sha256: "a".repeat(64),
    }),
    getRenderablePublishedLogo: jest.fn().mockResolvedValue({
      outcome: "found",
      objectKey: "private/published-object.webp",
      sha256: "b".repeat(64),
    }),
    reserveAsset: jest.fn().mockResolvedValue({
      outcome: "reserved",
      assetId,
      objectKeyPrefix: `${organizationId}/${assetId}/`,
    }),
    finalizeAsset: jest.fn().mockResolvedValue({
      outcome: "finalized",
      draft: draftBranding(),
    }),
    failAsset: jest.fn().mockResolvedValue(undefined),
    saveDraft: jest.fn().mockResolvedValue({
      outcome: "updated",
      draft: draftBranding(),
    }),
    publish: jest.fn().mockResolvedValue({
      outcome: "published",
      branding: publishedBranding(),
      idempotent: false,
    }),
    removeLogo: jest.fn().mockResolvedValue({
      outcome: "removed",
      branding: publishedBranding(),
      idempotent: false,
    }),
    ...(overrides.repository ?? {}),
  };
  const processor: LogoProcessorPort = {
    process: jest.fn().mockResolvedValue({
      bytes: Buffer.from("webp"),
      width: 128,
      height: 128,
      sha256: "a".repeat(64),
      inputBytes: 12,
    }),
    ...(overrides.processor ?? {}),
  };
  const storage: BrandingStoragePort = {
    upload: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue({
      outcome: "found",
      bytes: Buffer.from("webp"),
      mimeType: "image/webp",
    }),
    ...(overrides.storage ?? {}),
  };
  const scanner: BrandingScannerPort = {
    scan: jest.fn().mockResolvedValue({ status: "clean" }),
    ...(overrides.scanner ?? {}),
  };
  const identity: BrandingRequestIdentityPort = {
    create: jest.fn().mockReturnValue({ requestDigest: "b".repeat(64) }),
  };
  const scannerPolicy: BrandingScannerPolicyPort = {
    isStrict: jest.fn().mockReturnValue(false),
  };

  return {
    useCases: new BrandingUseCases(
      repository,
      processor,
      storage,
      scanner,
      scannerPolicy,
      identity,
    ),
    repository,
    processor,
    storage,
    scanner,
    scannerPolicy,
    identity,
  };
}

describe("BrandingUseCases", () => {
  it("returns the confirmed Sentinel fallback from the branding resolver", async () => {
    const { useCases } = harness({
      repository: {
        getResolved: jest.fn().mockResolvedValue({
          outcome: "found",
          branding: CRA_SENTINEL_BRANDING,
        }),
      },
    });

    await expect(
      useCases.getResolved({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: true,
      value: { branding: CRA_SENTINEL_BRANDING },
    });
  });

  it("keeps an inaccessible organization distinct from a branding fallback", async () => {
    const { useCases } = harness({
      repository: {
        getResolved: jest.fn().mockResolvedValue({ outcome: "not_found" }),
      },
    });

    await expect(
      useCases.getResolved({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("returns the persisted resolved draft snapshot when one exists", async () => {
    const { useCases } = harness({
      repository: {
        getDraft: jest.fn().mockResolvedValue({
          outcome: "found",
          branding: publishedBranding(),
        }),
      },
    });

    await expect(
      useCases.getDraft({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: true,
      value: { branding: publishedBranding() },
    });
  });

  it("maps unavailable read dependencies without leaking provider details", async () => {
    const { useCases } = harness({
      repository: {
        getResolved: jest.fn().mockRejectedValue(new Error("database detail")),
      },
    });

    await expect(
      useCases.getResolved({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("reserves, scans, uploads, and finalizes a normalized logo without exposing storage keys", async () => {
    const { useCases, repository, processor, storage, scanner } = harness();

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: "Acme logo",
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/png",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { draft: draftBranding() },
    });

    expect((repository.reserveAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, actorId, "Acme logo"],
    ]);
    expect((processor.process as jest.Mock).mock.calls).toEqual([
      [Buffer.from("input"), "image/png"],
    ]);
    expect((scanner.scan as jest.Mock).mock.calls).toEqual([
      [{ bytes: Buffer.from("webp"), sha256: "a".repeat(64) }],
    ]);
    expect((storage.upload as jest.Mock).mock.calls).toEqual([
      [
        `${organizationId}/${assetId}/${"a".repeat(64)}.webp`,
        Buffer.from("webp"),
        "image/webp",
      ],
    ]);
    expect((repository.finalizeAsset as jest.Mock).mock.calls).toEqual([
      [
        organizationId,
        assetId,
        actorId,
        {
          contentHash: "a".repeat(64),
          inputBytes: 12,
          width: 128,
          height: 128,
          scannerStatus: "clean",
        },
      ],
    ]);
  });

  it("compensates a reserved asset when scanning rejects the normalized logo", async () => {
    const { useCases, repository, storage } = harness({
      scanner: { scan: jest.fn().mockResolvedValue({ status: "rejected" }) },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/jpeg",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "scanner_rejected" },
    });

    expect((storage.upload as jest.Mock).mock.calls).toEqual([]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "scanner_rejected", true],
    ]);
  });

  it("finalizes an approved raster logo when no scanner is configured and strict mode is off", async () => {
    const { useCases, repository, storage } = harness({
      scanner: { scan: jest.fn().mockResolvedValue({ status: "unavailable" }) },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/png",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { draft: draftBranding() },
    });

    expect((storage.upload as jest.Mock).mock.calls).toEqual([
      [
        `${organizationId}/${assetId}/${"a".repeat(64)}.webp`,
        Buffer.from("webp"),
        "image/webp",
      ],
    ]);
    const finalizeCalls = (repository.finalizeAsset as jest.Mock).mock
      .calls as unknown[][];
    expect(finalizeCalls[0]?.[3]).toEqual({
      contentHash: "a".repeat(64),
      inputBytes: 12,
      width: 128,
      height: 128,
      scannerStatus: "scanner_not_available",
    });
  });

  it("quarantines and fails closed when scanner is unavailable under strict policy", async () => {
    const { useCases, repository, storage, scannerPolicy } = harness({
      scanner: { scan: jest.fn().mockResolvedValue({ status: "unavailable" }) },
    });
    (scannerPolicy.isStrict as jest.Mock).mockReturnValue(true);

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/png",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });

    expect((storage.upload as jest.Mock).mock.calls).toEqual([]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "scanner_not_available", true],
    ]);
  });

  it("removes uploaded bytes and marks the asset failed when finalization fails", async () => {
    const { useCases, repository, storage } = harness({
      repository: {
        finalizeAsset: jest.fn().mockResolvedValue({ outcome: "not_found" }),
      },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/webp",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });

    expect((storage.remove as jest.Mock).mock.calls).toEqual([
      [`${organizationId}/${assetId}/${"a".repeat(64)}.webp`],
    ]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "finalize_failed", false],
    ]);
  });

  it("removes uploaded bytes when finalization throws after upload", async () => {
    const { useCases, repository, storage } = harness({
      repository: {
        finalizeAsset: jest
          .fn()
          .mockRejectedValue(new BrandingProviderError("unavailable")),
      },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/webp",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });

    expect((storage.remove as jest.Mock).mock.calls).toEqual([
      [`${organizationId}/${assetId}/${"a".repeat(64)}.webp`],
    ]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "upload_failed", false],
    ]);
  });

  it("returns invalid request when an uploaded logo cannot be finalized", async () => {
    const { useCases, repository, storage } = harness({
      repository: {
        finalizeAsset: jest
          .fn()
          .mockResolvedValue({ outcome: "invalid_request" }),
      },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/webp",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect((storage.remove as jest.Mock).mock.calls).toEqual([
      [`${organizationId}/${assetId}/${"a".repeat(64)}.webp`],
    ]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "finalize_failed", false],
    ]);
  });

  it("returns not found before inspecting bytes when asset reservation is inaccessible", async () => {
    const { useCases, processor, scanner, storage } = harness({
      repository: {
        reserveAsset: jest.fn().mockResolvedValue({ outcome: "not_found" }),
      },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/png",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    expect((processor.process as jest.Mock).mock.calls).toEqual([]);
    expect((scanner.scan as jest.Mock).mock.calls).toEqual([]);
    expect((storage.upload as jest.Mock).mock.calls).toEqual([]);
  });

  it("maps rejected image inspection to invalid request and compensates its reservation", async () => {
    const invalidImage = Object.assign(new Error("bad image"), {
      code: "invalid_image",
    });
    const { useCases, repository, storage } = harness({
      processor: { process: jest.fn().mockRejectedValue(invalidImage) },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/png",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect((storage.remove as jest.Mock).mock.calls).toEqual([]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "upload_failed", false],
    ]);
  });

  it("swallows compensation errors and retains the original provider failure", async () => {
    const { useCases, repository, storage } = harness({
      storage: {
        upload: jest.fn().mockRejectedValue(new Error("storage unavailable")),
        remove: jest.fn().mockRejectedValue(new Error("remove unavailable")),
      },
      repository: {
        failAsset: jest.fn().mockRejectedValue(new Error("write unavailable")),
      },
    });

    await expect(
      useCases.uploadLogo({
        organizationId,
        actorId,
        altText: null,
        sourceBytes: Buffer.from("input"),
        declaredMimeType: "image/png",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    expect((storage.remove as jest.Mock).mock.calls).toEqual([
      [`${organizationId}/${assetId}/${"a".repeat(64)}.webp`],
    ]);
    expect((repository.failAsset as jest.Mock).mock.calls).toEqual([
      [organizationId, assetId, actorId, "upload_failed", false],
    ]);
  });

  it("binds publish and remove idempotency to organization, actor, and operation", async () => {
    const { useCases, repository, identity } = harness();

    await useCases.publish({
      organizationId,
      actorId,
      input: { expectedVersion: 1, idempotencyKey },
    });
    await useCases.removeLogo({
      organizationId,
      actorId,
      input: { expectedVersion: 2, idempotencyKey },
    });

    expect((identity.create as jest.Mock).mock.calls).toEqual([
      [
        {
          organizationId,
          actorId,
          idempotencyKey,
          operation: "publish_branding",
        },
      ],
      [
        {
          organizationId,
          actorId,
          idempotencyKey,
          operation: "remove_branding_logo",
        },
      ],
    ]);
    expect((repository.publish as jest.Mock).mock.calls).toEqual([
      [
        organizationId,
        actorId,
        { expectedVersion: 1, idempotencyKey },
        "b".repeat(64),
      ],
    ]);
    expect((repository.removeLogo as jest.Mock).mock.calls).toEqual([
      [
        organizationId,
        actorId,
        { expectedVersion: 2, idempotencyKey },
        "b".repeat(64),
      ],
    ]);
  });

  it.each([
    ["saveDraft", { outcome: "conflict", draft: draftBranding() }, "conflict"],
    ["saveDraft", { outcome: "invalid_request" }, "invalid_request"],
    ["saveDraft", { outcome: "not_found" }, "not_found"],
  ] as const)("maps %s outcome %s safely", async (operation, outcome, code) => {
    const { useCases } = harness({
      repository: { saveDraft: jest.fn().mockResolvedValue(outcome) },
    });

    await expect(
      useCases[operation]({
        organizationId,
        actorId,
        input: {
          expectedVersion: 1,
          displayName: "Acme",
          palette: { primary: "#000000", secondary: "#FFFFFF" },
          logoAssetId: null,
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });

  it("returns unavailable when saving a branding draft throws", async () => {
    const { useCases } = harness({
      repository: { saveDraft: jest.fn().mockRejectedValue(new Error("down")) },
    });

    await expect(
      useCases.saveDraft({
        organizationId,
        actorId,
        input: {
          expectedVersion: 1,
          displayName: "Acme",
          palette: { primary: "#000000", secondary: "#FFFFFF" },
          logoAssetId: null,
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it.each([
    ["publish", { outcome: "conflict" }, "conflict"],
    ["publish", { outcome: "invalid_request" }, "invalid_request"],
    ["publish", { outcome: "not_found" }, "not_found"],
    ["removeLogo", { outcome: "conflict" }, "conflict"],
    ["removeLogo", { outcome: "invalid_request" }, "invalid_request"],
    ["removeLogo", { outcome: "not_found" }, "not_found"],
  ] as const)(
    "maps %s publication outcome safely",
    async (operation, outcome, code) => {
      const { useCases } = harness({
        repository:
          operation === "publish"
            ? { publish: jest.fn().mockResolvedValue(outcome) }
            : { removeLogo: jest.fn().mockResolvedValue(outcome) },
      });
      const command = {
        organizationId,
        actorId,
        input: { expectedVersion: 1, idempotencyKey },
      };

      await expect(
        operation === "publish"
          ? useCases.publish(command)
          : useCases.removeLogo(command),
      ).resolves.toEqual({ ok: false, error: { code } });
    },
  );

  it("maps publication provider failures without exposing their cause", async () => {
    const { useCases } = harness({
      repository: {
        publish: jest
          .fn()
          .mockRejectedValue(new BrandingProviderError("malformed")),
        removeLogo: jest.fn().mockRejectedValue(new Error("dependency down")),
      },
    });
    const command = {
      organizationId,
      actorId,
      input: { expectedVersion: 1, idempotencyKey },
    };

    await expect(useCases.publish(command)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    await expect(useCases.removeLogo(command)).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("renders an approved logo through storage without returning an object key", async () => {
    const { useCases, repository, storage } = harness();

    await expect(
      useCases.renderLogo({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: true,
      value: {
        bytes: Buffer.from("webp"),
        mimeType: "image/webp",
        sha256: "a".repeat(64),
      },
    });

    expect((repository.getRenderableLogo as jest.Mock).mock.calls).toEqual([
      [organizationId, actorId],
    ]);
    expect((storage.download as jest.Mock).mock.calls).toEqual([
      ["private/object.webp", "a".repeat(64)],
    ]);
  });

  it("renders only the published approved logo through storage", async () => {
    const { useCases, repository, storage } = harness();

    await expect(
      useCases.renderPublishedLogo({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: true,
      value: {
        bytes: Buffer.from("webp"),
        mimeType: "image/webp",
        sha256: "b".repeat(64),
      },
    });

    expect(
      (repository.getRenderablePublishedLogo as jest.Mock).mock.calls,
    ).toEqual([[organizationId, actorId]]);
    expect((storage.download as jest.Mock).mock.calls).toEqual([
      ["private/published-object.webp", "b".repeat(64)],
    ]);
  });

  it("treats a missing approved storage object as not found for raster rendering", async () => {
    const { useCases } = harness({
      storage: {
        download: jest.fn().mockResolvedValue({ outcome: "not_found" }),
      },
    });

    await expect(
      useCases.renderLogo({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("maps render lookup and download errors to safe provider failures", async () => {
    const repositoryFailure = harness({
      repository: {
        getRenderableLogo: jest
          .fn()
          .mockRejectedValue(new BrandingProviderError("malformed")),
      },
    });
    const storageFailure = harness({
      storage: { download: jest.fn().mockRejectedValue(new Error("down")) },
    });

    await expect(
      repositoryFailure.useCases.renderLogo({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    await expect(
      storageFailure.useCases.renderLogo({ organizationId, actorId }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("maps malformed provider failures distinctly from unavailable dependencies", async () => {
    const { useCases } = harness({
      repository: {
        getDraft: jest
          .fn()
          .mockRejectedValue(new BrandingProviderError("malformed")),
      },
    });

    await expect(
      useCases.getDraft({ organizationId, actorId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
  });
});
