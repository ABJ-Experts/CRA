import { describe, expect, it } from "vitest";
import {
  upgradeApplyInputSchema,
  upgradeJwsHeaderSchema,
  upgradeMutationSchema,
  upgradeRunStateSchema,
} from "./schemas/index.js";
describe("upgrade security contracts", () => {
  it("separates release signing purpose and rejects algorithm substitution", () => {
    expect(
      upgradeJwsHeaderSchema.parse({
        alg: "EdDSA",
        typ: "CRA-RELEASE+JWS",
        kid: "release-2026",
      }).alg,
    ).toBe("EdDSA");
    for (const alg of ["none", "HS256", "ES256"])
      expect(
        upgradeJwsHeaderSchema.safeParse({
          alg,
          typ: "CRA-RELEASE+JWS",
          kid: "release",
        }).success,
      ).toBe(false);
    expect(
      upgradeJwsHeaderSchema.safeParse({
        alg: "EdDSA",
        typ: "JWT",
        kid: "release",
      }).success,
    ).toBe(false);
  });
  it("binds explicit apply consent to a version and fingerprint", () => {
    const mutation = {
      expectedVersion: 0,
      idempotencyKey: "7a80b0af-c932-48dd-b1cf-a9addb620d12",
    };
    expect(upgradeMutationSchema.safeParse(mutation).success).toBe(true);
    expect(upgradeApplyInputSchema.safeParse(mutation).success).toBe(false);
    expect(
      upgradeApplyInputSchema.safeParse({
        ...mutation,
        fingerprint: "a".repeat(64),
        acknowledgedEffects: true,
      }).success,
    ).toBe(true);
    expect(
      upgradeApplyInputSchema.safeParse({
        ...mutation,
        fingerprint: "a".repeat(64),
        acknowledgedEffects: false,
      }).success,
    ).toBe(false);
    expect(
      upgradeMutationSchema.safeParse({ ...mutation, path: "/private" })
        .success,
    ).toBe(false);
  });
  it("rejects invented durable states", () => {
    expect(upgradeRunStateSchema.safeParse("awaiting-initiation").success).toBe(
      true,
    );
    expect(upgradeRunStateSchema.safeParse("completed").success).toBe(false);
  });
});

import {
  upgradeManifestSchema,
  upgradePreflightSchema,
  upgradeRunSchema,
  upgradeResultSchema,
} from "./schemas/index.js";
const uuid = "7a80b0af-c932-48dd-b1cf-a9addb620d12";
const hash = "a".repeat(64);
const issuedAt = "2026-10-15T00:00:00Z";
const expiresAt = "2026-11-15T00:00:00Z";
const manifest = {
  manifestVersion: 1,
  purpose: "cra-offline-application-release",
  issuer: "cra",
  releaseId: uuid,
  version: "1.2.3",
  sequence: 1,
  issuedAt,
  expiresAt,
  platform: { os: "linux", architecture: "amd64" },
  compatibility: {
    sourceVersions: ["1.2.2"],
    sourceManifestDigests: [hash],
    sourceSchemaDigests: [hash],
    targetSchemaDigest: hash,
    supervisorVersions: ["1.0.0"],
  },
  infrastructure: {
    postgres: hash,
    auth: hash,
    rest: hash,
    storage: hash,
    supervisor: hash,
  },
  archive: {
    name: "payload.tar",
    sha256: hash,
    bytes: 1024,
    expandedBytes: 2048,
    entryCount: 2,
  },
  images: [
    {
      service: "api",
      digest: `sha256:${hash}`,
      archive: { name: "api.tar", sha256: hash, bytes: 1024 },
    },
  ],
  migrations: [
    {
      name: "20261015000000_additive.sql",
      sha256: hash,
      transactional: true,
      backwardCompatible: true,
    },
  ],
  artifacts: [{ name: "sbom.json", sha256: hash, bytes: 2048, kind: "sbom" }],
  requirements: {
    diskBytes: 4096,
    memoryBytes: 4096,
    backupRequired: true,
    keyRequired: true,
  },
  expectedOutageSeconds: 300,
  licenseEffects: ["unchanged"],
  rollback: { imageOnly: true, backwardCompatible: true },
};
describe("release manifest boundary", () => {
  it("accepts pinned complete application release inventories", () => {
    expect(upgradeManifestSchema.parse(manifest).version).toBe("1.2.3");
    expect(
      upgradeManifestSchema.parse({
        ...manifest,
        platform: { os: "linux", architecture: "arm64" },
      }).platform.architecture,
    ).toBe("arm64");
  });
  it.each([
    { ...manifest, purpose: "backup" },
    { ...manifest, platform: { os: "darwin", architecture: "amd64" } },
    { ...manifest, version: "latest" },
    { ...manifest, sequence: 0 },
    { ...manifest, expiresAt: issuedAt },
    {
      ...manifest,
      compatibility: { ...manifest.compatibility, sourceVersions: ["*"] },
    },
    {
      ...manifest,
      compatibility: { ...manifest.compatibility, sourceManifestDigests: [] },
    },
    {
      ...manifest,
      infrastructure: { ...manifest.infrastructure, auth: "latest" },
    },
    { ...manifest, images: [manifest.images[0], manifest.images[0]] },
    {
      ...manifest,
      images: [
        {
          ...manifest.images[0],
          archive: { name: "../api.tar", sha256: hash, bytes: 1 },
        },
      ],
    },
    {
      ...manifest,
      migrations: [{ ...manifest.migrations[0], transactional: false }],
    },
    {
      ...manifest,
      migrations: [{ ...manifest.migrations[0], backwardCompatible: false }],
    },
    {
      ...manifest,
      migrations: [manifest.migrations[0], manifest.migrations[0]],
    },
    {
      ...manifest,
      requirements: { ...manifest.requirements, backupRequired: false },
    },
    { ...manifest, rollback: { imageOnly: false, backwardCompatible: true } },
    { ...manifest, hooks: ["sh unsafe"] },
  ])("rejects incompatible or ambiguous inventory %#", (candidate) => {
    expect(upgradeManifestSchema.safeParse(candidate).success).toBe(false);
  });
});
describe("redacted operational outputs", () => {
  const review = {
    runId: uuid,
    version: 1,
    fingerprint: hash,
    checkedAt: issuedAt,
    expiresAt,
    eligible: true,
    summary: {
      fromVersion: "1.2.2",
      toVersion: "1.2.3",
      manifestDigest: hash,
      expectedOutageSeconds: 300,
      licenseEffects: ["unchanged"],
      rollback: "compatible-images-before-exposure",
      dataRestored: false,
      migrationsReversed: false,
    },
    checks: [{ code: "signature", status: "passed", detail: "verified" }],
  };
  const run = {
    id: uuid,
    instanceId: uuid,
    mediaId: uuid,
    version: 1,
    state: "awaiting-initiation",
    releaseId: uuid,
    fromVersion: "1.2.2",
    toVersion: "1.2.3",
    manifestDigest: hash,
    verified: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    completedAt: null,
    failureCode: null,
    preflight: review,
    result: null,
  };
  it("rejects failed or stale eligible reviews", () => {
    expect(upgradePreflightSchema.parse(review).eligible).toBe(true);
    expect(
      upgradePreflightSchema.safeParse({ ...review, summary: undefined })
        .success,
    ).toBe(false);
    expect(
      upgradePreflightSchema.safeParse({
        ...review,
        summary: { ...review.summary, dataRestored: true },
      }).success,
    ).toBe(false);
    expect(
      upgradePreflightSchema.safeParse({
        ...review,
        checks: [{ code: "signature", status: "failed", detail: "mismatch" }],
      }).success,
    ).toBe(false);
    expect(
      upgradePreflightSchema.safeParse({ ...review, expiresAt: issuedAt })
        .success,
    ).toBe(false);
  });
  it("requires verified release authority before advancement", () => {
    expect(upgradeRunSchema.parse(run).verified).toBe(true);
    expect(
      upgradeRunSchema.safeParse({ ...run, verified: false }).success,
    ).toBe(false);
    expect(
      upgradeRunSchema.safeParse({ ...run, manifestDigest: null }).success,
    ).toBe(false);
    expect(
      upgradeRunSchema.safeParse({
        ...run,
        state: "verifying",
        verified: false,
        manifestDigest: null,
      }).success,
    ).toBe(true);
  });
  it("rejects native diagnostics or data-restore claims", () => {
    const result = {
      runId: uuid,
      outcome: "success",
      instanceId: uuid,
      fromVersion: "1.2.2",
      toVersion: "1.2.3",
      manifestDigest: hash,
      startedAt: issuedAt,
      checkedAt: issuedAt,
      checks: [],
      safeRemediation: [],
      imageDigests: [`sha256:${hash}`],
      completedAt: expiresAt,
      failureCode: null,
      maintenanceRetained: false,
      exposurePossible: true,
      dataRestored: false,
      migrationsReversed: false,
      evidenceId: uuid,
    };
    expect(upgradeResultSchema.parse(result).dataRestored).toBe(false);
    expect(
      upgradeResultSchema.safeParse({ ...result, stderr: "/private/secret" })
        .success,
    ).toBe(false);
    expect(
      upgradeResultSchema.safeParse({ ...result, dataRestored: true }).success,
    ).toBe(false);
  });
});

import {
  upgradeControlRequestSchema,
  upgradeControlResponseSchema,
} from "./schemas/index.js";
describe("authenticated private control envelopes", () => {
  const actor = {
    principalId: uuid,
    fingerprint256: Array(32).fill("AB").join(":"),
    grantRevision: "grant-1",
  };
  it("requires canonical peer identity and a recognized internal action", () => {
    const request = {
      requestId: uuid,
      instanceId: uuid,
      actor,
      action: "media/list",
      issuedAt,
      mac: hash,
    };
    expect(upgradeControlRequestSchema.parse(request).action).toBe(
      "media/list",
    );
    expect(
      upgradeControlRequestSchema.safeParse({
        ...request,
        actor: { ...actor, fingerprint256: "ab".repeat(32) },
      }).success,
    ).toBe(false);
    expect(
      upgradeControlRequestSchema.safeParse({
        ...request,
        action: "shell/execute",
      }).success,
    ).toBe(false);
  });
  it("allows only consistent safe response envelopes", () => {
    expect(
      upgradeControlResponseSchema.safeParse({
        requestId: uuid,
        ok: true,
        status: 200,
        value: {},
        mac: hash,
      }).success,
    ).toBe(true);
    expect(
      upgradeControlResponseSchema.safeParse({
        requestId: uuid,
        ok: false,
        status: 403,
        mac: hash,
      }).success,
    ).toBe(true);
    for (const [ok, status] of [
      [true, 403],
      [false, 200],
      [false, 500],
    ])
      expect(
        upgradeControlResponseSchema.safeParse({
          requestId: uuid,
          ok,
          status,
          mac: hash,
        }).success,
      ).toBe(false);
    expect(
      upgradeControlResponseSchema.safeParse({
        requestId: uuid,
        ok: false,
        status: 503,
        error: "native stderr",
        mac: hash,
      }).success,
    ).toBe(false);
  });
  it("requires one exact source digest tuple per source version", () => {
    expect(
      upgradeManifestSchema.safeParse({
        ...manifest,
        compatibility: {
          ...manifest.compatibility,
          sourceVersions: ["1.2.2", "1.2.1"],
        },
      }).success,
    ).toBe(false);
  });
});

describe("signed release artifact inventory", () => {
  it("requires exactly one hashed SBOM with disjoint archive names", () => {
    expect(upgradeManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      upgradeManifestSchema.safeParse({ ...manifest, artifacts: [] }).success,
    ).toBe(false);
    expect(
      upgradeManifestSchema.safeParse({
        ...manifest,
        artifacts: [
          manifest.artifacts[0],
          { ...manifest.artifacts[0], name: "other.json" },
        ],
      }).success,
    ).toBe(false);
    expect(
      upgradeManifestSchema.safeParse({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], name: "../sbom.json" }],
      }).success,
    ).toBe(false);
    expect(
      upgradeManifestSchema.safeParse({
        ...manifest,
        artifacts: [
          manifest.artifacts[0],
          {
            ...manifest.artifacts[0],
            name: "notes.txt",
            kind: "release-notes",
          },
        ],
      }).success,
    ).toBe(true);
  });
  it("rejects unsupported image roles", () => {
    expect(
      upgradeManifestSchema.safeParse({
        ...manifest,
        images: [{ ...manifest.images[0], service: "arbitrary-container" }],
      }).success,
    ).toBe(false);
  });
});
