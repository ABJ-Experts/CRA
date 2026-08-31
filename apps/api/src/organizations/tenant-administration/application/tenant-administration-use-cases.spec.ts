import type {
  MfaRolloutReadiness,
  OrganizationLifecycle,
  OrganizationSettings,
  RetentionPolicy,
} from "@repo/contracts/organizations";

import {
  TenantAdministrationProviderError,
  TenantAdministrationUseCases,
  type TenantAdministrationRepository,
} from "./tenant-administration-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const exportId = "00000000-0000-4000-8000-000000000004";
const grantId = "00000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-10T12:00:00.000Z");

const readiness = Object.freeze<MfaRolloutReadiness>({
  enrolledMemberCount: 2,
  unenrolledMemberCount: 0,
  safeToEnforce: true,
});
const settingsValues = {
  timezone: "Asia/Kolkata",
  workingDays: ["monday", "tuesday"],
  holidays: [],
  notificationChannelIds: ["email"],
  mfaEnforcementDate: null,
  maximumSessionAgeMinutes: 60,
  aiProviderId: "disabled",
  dataResidencyId: "in",
} satisfies NonNullable<
  Extract<OrganizationSettings, { status: "configured" }>["values"]
>;
const settings = Object.freeze<OrganizationSettings>({
  status: "configured",
  version: 2,
  values: settingsValues,
});
const policy = Object.freeze<RetentionPolicy>({
  id: "00000000-0000-4000-8000-000000000006",
  evidenceClass: "audit_log",
  version: 1,
  requestedRetentionDays: 30,
  effectiveRetentionDays: 30,
  effectiveFloorDays: 0,
  controllingReasons: [],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
});
const lifecycle = Object.freeze<OrganizationLifecycle>({
  status: "active",
  version: 3,
  changedAt: "2026-08-10T00:00:00.000Z",
  error: null,
  blockers: [],
});
const organizationExport = Object.freeze({
  id: exportId,
  status: "queued" as const,
  progress: { completedParts: 0, totalParts: 0 },
  error: null,
  manifest: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

function repository(
  overrides: Partial<TenantAdministrationRepository> = {},
): jest.Mocked<TenantAdministrationRepository> {
  return {
    getSettings: jest.fn().mockResolvedValue({ outcome: "found", settings }),
    getSettingsCatalog: jest.fn(),
    updateSettings: jest
      .fn()
      .mockResolvedValue({ outcome: "updated", settings }),
    getRetentionPolicies: jest
      .fn()
      .mockResolvedValue({ outcome: "found", policies: [policy] }),
    updateRetentionPolicy: jest
      .fn()
      .mockResolvedValue({ outcome: "updated", policy }),
    requestExport: jest.fn().mockResolvedValue({
      outcome: "created",
      export: organizationExport,
      idempotent: false,
    }),
    getExport: jest.fn(),
    getLatestExport: jest.fn().mockResolvedValue(organizationExport),
    getLifecycle: jest.fn().mockResolvedValue({ outcome: "found", lifecycle }),
    createReauthenticationGrant: jest.fn().mockResolvedValue({
      outcome: "created",
      reauthenticationGrantId: grantId,
      expiresAt: "2026-08-10T12:10:00.000Z",
    }),
    deactivate: jest.fn().mockResolvedValue({ outcome: "updated", lifecycle }),
    schedulePurge: jest
      .fn()
      .mockResolvedValue({ outcome: "updated", lifecycle }),
    recover: jest.fn().mockResolvedValue({ outcome: "updated", lifecycle }),
    ...overrides,
  } as jest.Mocked<TenantAdministrationRepository>;
}

function harness(
  overrides: Partial<TenantAdministrationRepository> = {},
  readinessResult: MfaRolloutReadiness = readiness,
) {
  const repo = repository(overrides);
  const mfaReadiness = {
    read: jest.fn().mockResolvedValue(readinessResult),
  };
  const reauthentication = {
    verify: jest.fn().mockResolvedValue({ outcome: "verified" }),
  };
  const downloads = {
    createDownload: jest.fn().mockResolvedValue({ outcome: "unavailable" }),
  };
  const requestIdentity = {
    create: jest.fn().mockReturnValue({
      requestDigest: "a".repeat(64),
      correlationId: "correlation-1",
    }),
  };
  const useCases = new TenantAdministrationUseCases(
    repo,
    mfaReadiness,
    reauthentication,
    downloads,
    requestIdentity,
    { now: () => now },
  );
  return {
    useCases,
    repo,
    mfaReadiness,
    reauthentication,
    downloads,
    requestIdentity,
  };
}

describe("TenantAdministrationUseCases", () => {
  it("composes stored settings with authoritative PII-free MFA readiness", async () => {
    const { useCases, mfaReadiness } = harness();

    await expect(useCases.settings(organizationId)).resolves.toEqual({
      ok: true,
      value: { settings, mfaRolloutReadiness: readiness },
    });
    expect(mfaReadiness.read).toHaveBeenCalledWith(organizationId);
  });

  it("rejects an unsafe MFA enforcement date before the settings RPC", async () => {
    const unsafe = {
      ...readiness,
      unenrolledMemberCount: 1,
      safeToEnforce: false,
    };
    const { useCases, repo } = harness({}, unsafe);
    const input = {
      expectedVersion: 2,
      values: {
        ...settingsValues,
        mfaEnforcementDate: "2026-08-11",
      },
    } as const;
    await expect(
      useCases.updateSettings({ organizationId, actorId, sessionId, input }),
    ).resolves.toEqual({ ok: false, error: { code: "mfa_not_ready" } });
    expect(repo.updateSettings.mock.calls).toHaveLength(0);
  });

  it("rejects a non-future MFA enforcement date before persistence", async () => {
    const { useCases, repo } = harness();

    await expect(
      useCases.updateSettings({
        organizationId,
        actorId,
        sessionId,
        input: {
          expectedVersion: 2,
          values: { ...settingsValues, mfaEnforcementDate: "2026-08-10" },
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(repo.updateSettings.mock.calls).toHaveLength(0);
  });

  it("preserves safe optimistic-conflict details", async () => {
    const { useCases } = harness({
      updateRetentionPolicy: jest.fn().mockResolvedValue({
        outcome: "conflict",
        policy,
      }),
    });

    await expect(
      useCases.updateRetention({
        organizationId,
        actorId,
        input: {
          evidenceClass: "audit_log",
          expectedVersion: 0,
          requestedRetentionDays: 10,
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "conflict", current: policy },
    });
  });

  it("generates the export digest and correlation id on the server", async () => {
    const { useCases, repo, requestIdentity } = harness();
    const idempotencyKey = "00000000-0000-4000-8000-000000000007";

    await expect(
      useCases.requestExport({ organizationId, actorId, idempotencyKey }),
    ).resolves.toMatchObject({ ok: true, value: { idempotent: false } });
    expect(requestIdentity.create.mock.calls).toEqual([
      [{ organizationId, actorId, idempotencyKey }],
    ]);
    expect(repo.requestExport.mock.calls).toEqual([
      [
        organizationId,
        actorId,
        idempotencyKey,
        "a".repeat(64),
        "correlation-1",
      ],
    ]);
  });

  it("fails export downloads closed when Task 3b has not supplied storage", async () => {
    const { useCases, downloads } = harness();

    await expect(
      useCases.downloadExport({ organizationId, exportId, actorId }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    expect(downloads.createDownload).toHaveBeenCalledWith(
      organizationId,
      exportId,
      actorId,
    );
  });

  it("verifies password and MFA without passing raw secrets to persistence", async () => {
    const { useCases, repo, reauthentication } = harness();

    await expect(
      useCases.reauthenticate({
        organizationId,
        actorId,
        sessionId,
        email: "owner@cra.test",
        accessToken: "access-token",
        password: "raw-password",
        mfaCode: "123456",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        reauthenticationGrantId: grantId,
        expiresAt: "2026-08-10T12:10:00.000Z",
      },
    });
    expect(reauthentication.verify).toHaveBeenCalledWith({
      email: "owner@cra.test",
      password: "raw-password",
      accessToken: "access-token",
      actorId,
      mfaCode: "123456",
    });
    expect(repo.createReauthenticationGrant.mock.calls).toEqual([
      [
        organizationId,
        actorId,
        sessionId,
        lifecycle.version,
        "2026-08-10T12:10:00.000Z",
      ],
    ]);
    expect(
      JSON.stringify(repo.createReauthenticationGrant.mock.calls),
    ).not.toContain("raw-password");
    expect(
      JSON.stringify(repo.createReauthenticationGrant.mock.calls),
    ).not.toContain("123456");
  });

  it("maps every lifecycle mutation to its strict response shape", async () => {
    const { useCases, repo } = harness();
    const common = {
      organizationId,
      actorId,
      sessionId,
      reauthenticationGrantId: grantId,
      expectedVersion: lifecycle.version,
    };

    await expect(
      useCases.deactivate({
        ...common,
        confirmation: "DEACTIVATE ORGANIZATION",
      }),
    ).resolves.toEqual({ ok: true, value: { lifecycle } });
    await expect(
      useCases.schedulePurge({ ...common, confirmation: "DELETE acme" }),
    ).resolves.toEqual({ ok: true, value: { lifecycle } });
    await expect(useCases.recover(common)).resolves.toEqual({
      ok: true,
      value: { lifecycle },
    });
    expect(repo.deactivate.mock.calls).toHaveLength(1);
    expect(repo.schedulePurge.mock.calls).toHaveLength(1);
    expect(repo.recover.mock.calls).toHaveLength(1);
  });

  it("maps settings/catalog/retention reads and generic not-found outcomes", async () => {
    const catalog = {
      timezones: ["Asia/Kolkata"],
      notificationChannels: [],
      aiProviders: [],
      dataResidencies: [],
      minimumSessionAgeMinutes: 5,
      maximumSessionAgeMinutes: 60,
    };
    const { useCases } = harness({
      getSettingsCatalog: jest
        .fn()
        .mockResolvedValueOnce({ outcome: "found", catalog })
        .mockResolvedValueOnce({ outcome: "not_found" }),
      getRetentionPolicies: jest
        .fn()
        .mockResolvedValueOnce({ outcome: "found", policies: [policy] })
        .mockResolvedValueOnce({ outcome: "not_found" }),
      getSettings: jest.fn().mockResolvedValue({ outcome: "not_found" }),
    });

    await expect(useCases.settingsCatalog(organizationId)).resolves.toEqual({
      ok: true,
      value: { catalog },
    });
    await expect(useCases.settingsCatalog(organizationId)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(useCases.retention(organizationId)).resolves.toEqual({
      ok: true,
      value: { policies: [policy] },
    });
    await expect(useCases.retention(organizationId)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(useCases.settings(organizationId)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it.each([
    ["invalid_request", "invalid_request"],
    ["not_found", "not_found"],
  ] as const)("maps settings write %s", async (outcome, code) => {
    const { useCases } = harness({
      updateSettings: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      useCases.updateSettings({
        organizationId,
        actorId,
        sessionId,
        input: { expectedVersion: 2, values: settingsValues },
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });

  it("returns a successful settings update and fresh readiness", async () => {
    const { useCases } = harness();

    await expect(
      useCases.updateSettings({
        organizationId,
        actorId,
        sessionId,
        input: { expectedVersion: 2, values: settingsValues },
      }),
    ).resolves.toEqual({
      ok: true,
      value: { settings, mfaRolloutReadiness: readiness },
    });
  });

  it.each([
    ["invalid_request", "invalid_request"],
    ["not_found", "not_found"],
  ] as const)("maps retention write %s", async (outcome, code) => {
    const { useCases } = harness({
      updateRetentionPolicy: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      useCases.updateRetention({
        organizationId,
        actorId,
        input: {
          evidenceClass: "audit_log",
          expectedVersion: 1,
          requestedRetentionDays: 30,
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });

  it("returns successful retention writes", async () => {
    const { useCases } = harness();

    await expect(
      useCases.updateRetention({
        organizationId,
        actorId,
        input: {
          evidenceClass: "audit_log",
          expectedVersion: 1,
          requestedRetentionDays: 30,
        },
      }),
    ).resolves.toEqual({ ok: true, value: { policies: [policy] } });
  });

  it.each([
    ["conflict", "conflict"],
    ["invalid_request", "invalid_request"],
    ["not_found", "not_found"],
  ] as const)("maps export request %s", async (outcome, code) => {
    const { useCases } = harness({
      requestExport: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      useCases.requestExport({
        organizationId,
        actorId,
        idempotencyKey: "00000000-0000-4000-8000-000000000007",
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });

  it("maps export status and download outcomes", async () => {
    const download = {
      url: "https://example.test/export.zip",
      filename: "export.zip",
      expiresInSeconds: 900,
    };
    const statusHarness = harness({
      getExport: jest
        .fn()
        .mockResolvedValueOnce({ outcome: "found", value: organizationExport })
        .mockResolvedValueOnce({ outcome: "not_found" }),
    });
    statusHarness.downloads.createDownload
      .mockResolvedValueOnce({ outcome: "available", download })
      .mockResolvedValueOnce({ outcome: "not_found" });

    await expect(
      statusHarness.useCases.exportStatus({ organizationId, exportId }),
    ).resolves.toEqual({ ok: true, value: { export: organizationExport } });
    await expect(
      statusHarness.useCases.exportStatus({ organizationId, exportId }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    await expect(
      statusHarness.useCases.downloadExport({
        organizationId,
        exportId,
        actorId,
      }),
    ).resolves.toEqual({ ok: true, value: download });
    await expect(
      statusHarness.useCases.downloadExport({
        organizationId,
        exportId,
        actorId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("returns the latest server-owned export, including an explicit empty state", async () => {
    const getLatestExport = jest
      .fn()
      .mockResolvedValueOnce(organizationExport)
      .mockResolvedValueOnce(null);
    const { useCases } = harness({ getLatestExport });

    await expect(useCases.latestExport(organizationId)).resolves.toEqual({
      ok: true,
      value: { export: organizationExport },
    });
    await expect(useCases.latestExport(organizationId)).resolves.toEqual({
      ok: true,
      value: { export: null },
    });
    expect(getLatestExport).toHaveBeenCalledWith(organizationId);
  });

  it.each(["invalid_password", "invalid_mfa"] as const)(
    "rejects destructive reauthentication outcome %s",
    async (outcome) => {
      const { useCases, reauthentication } = harness();
      reauthentication.verify.mockResolvedValue({ outcome });

      await expect(
        useCases.reauthenticate({
          organizationId,
          actorId,
          sessionId,
          email: "owner@cra.test",
          accessToken: "access-token",
          password: "secret",
        }),
      ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    },
  );

  it.each([
    ["mfa_required", "mfa_required"],
    ["unavailable", "unavailable"],
  ] as const)("maps reauthentication %s", async (outcome, code) => {
    const { useCases, reauthentication } = harness();
    reauthentication.verify.mockResolvedValue({ outcome });

    await expect(
      useCases.reauthenticate({
        organizationId,
        actorId,
        sessionId,
        email: "owner@cra.test",
        accessToken: "access-token",
        password: "secret",
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });

  it("maps malformed and unavailable provider failures without leaking them", async () => {
    const malformed = harness({
      getSettings: jest
        .fn()
        .mockRejectedValue(new TenantAdministrationProviderError("malformed")),
    });
    const unavailable = harness({
      getLifecycle: jest.fn().mockRejectedValue(new Error("private outage")),
    });

    await expect(malformed.useCases.settings(organizationId)).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    await expect(
      unavailable.useCases.lifecycle(organizationId),
    ).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it.each([
    "invalid_grant",
    "invalid_request",
    "conflict",
    "invalid_state",
    "not_found",
  ] as const)("maps lifecycle mutation outcome %s", async (outcome) => {
    const { useCases } = harness({
      deactivate: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      useCases.deactivate({
        organizationId,
        actorId,
        sessionId,
        reauthenticationGrantId: grantId,
        expectedVersion: 3,
        confirmation: "DEACTIVATE ORGANIZATION",
      }),
    ).resolves.toEqual({ ok: false, error: { code: outcome } });
  });
});
