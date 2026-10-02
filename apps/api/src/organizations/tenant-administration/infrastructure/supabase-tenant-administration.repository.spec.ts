import { SupabaseTenantAdministrationRepository } from "./supabase-tenant-administration.repository";
import type {
  OrganizationLifecycle,
  OrganizationSettings,
  RetentionPolicy,
  UpdateOrganizationSettingsInput,
} from "@repo/contracts/organizations";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const exportId = "00000000-0000-4000-8000-000000000004";
const settings: OrganizationSettings = {
  status: "configured",
  version: 2,
  values: {
    timezone: "Asia/Kolkata",
    workingDays: ["monday"],
    holidays: [],
    notificationChannelIds: [],
    mfaEnforcementDate: null,
    maximumSessionAgeMinutes: 60,
    aiProviderId: "disabled",
    dataResidencyId: "in",
  },
};
const lifecycle: OrganizationLifecycle = {
  status: "active",
  version: 1,
  changedAt: "2026-08-10T00:00:00.000Z",
  blockers: [],
  error: null,
};
const policy: RetentionPolicy = {
  id: "00000000-0000-4000-8000-000000000006",
  evidenceClass: "audit_log",
  version: 1,
  requestedRetentionDays: 30,
  effectiveRetentionDays: 30,
  effectiveFloorDays: 0,
  controllingReasons: [],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};
const exportRow = {
  id: exportId,
  status: "queued",
  completed_parts: 0,
  total_parts: 0,
  manifest_format_version: null,
  manifest_sha256: null,
  manifest_file_count: null,
  verified_at: null,
  safe_error_code: null,
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
};

function query(result: Readonly<{ data: unknown; error: unknown }>) {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    maybeSingle: jest.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

function harness(
  rpcResult: Readonly<{ data: unknown; error: unknown }>,
  queryResult: Readonly<{ data: unknown; error: unknown }> = {
    data: null,
    error: null,
  },
) {
  const rpc = jest.fn().mockResolvedValue(rpcResult);
  const exportQuery = query(queryResult);
  const from = jest.fn().mockReturnValue(exportQuery);
  return {
    repository: new SupabaseTenantAdministrationRepository({
      admin: () => ({ rpc, from }),
    } as never),
    rpc,
    from,
    exportQuery,
  };
}

describe("SupabaseTenantAdministrationRepository", () => {
  it("uses the exact settings RPC parameters and parses its strict JSON", async () => {
    const values: UpdateOrganizationSettingsInput["values"] = {
      timezone: "Asia/Kolkata",
      workingDays: ["monday"],
      holidays: [],
      notificationChannelIds: [],
      mfaEnforcementDate: null,
      maximumSessionAgeMinutes: 60,
      aiProviderId: "disabled",
      dataResidencyId: "in",
    };
    const settings = {
      status: "configured",
      version: 2,
      values,
    };
    const { repository, rpc } = harness({
      data: [{ outcome: "updated", settings, session_policy_tightened: true }],
      error: null,
    });

    await expect(
      repository.updateSettings(organizationId, actorId, sessionId, {
        expectedVersion: 1,
        values,
      }),
    ).resolves.toEqual({
      outcome: "updated",
      settings,
      sessionPolicyTightened: true,
    });
    expect(rpc).toHaveBeenCalledWith("update_organization_settings_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_expected_version: 1,
      p_timezone: "Asia/Kolkata",
      p_working_days: ["monday"],
      p_holidays: [],
      p_notification_channel_ids: [],
      p_mfa_enforcement_date: null,
      p_maximum_session_age_minutes: 60,
      p_ai_provider_id: "disabled",
      p_data_residency_id: "in",
      p_session_id: sessionId,
    });
  });

  it("maps paused and dead-letter export rows to a contract-safe failed status", async () => {
    const { repository, exportQuery } = harness(
      { data: [], error: null },
      {
        data: {
          id: exportId,
          status: "paused",
          completed_parts: 1,
          total_parts: 2,
          manifest_format_version: null,
          manifest_sha256: null,
          manifest_file_count: null,
          verified_at: null,
          created_at: "2026-08-10T00:00:00.000Z",
          updated_at: "2026-08-10T01:00:00.000Z",
        },
        error: null,
      },
    );

    const result = await repository.getExport(organizationId, exportId);
    expect(result.outcome).toBe("found");
    if (result.outcome !== "found") throw new Error("Expected export");
    expect(result.value.status).toBe("failed");
    expect(result.value.error).toEqual({
      code: "unavailable",
      message: "Organization administration request could not be completed.",
    });
    expect(exportQuery.eq).toHaveBeenNthCalledWith(
      1,
      "organization_id",
      organizationId,
    );
    expect(exportQuery.eq).toHaveBeenNthCalledWith(2, "id", exportId);
  });

  it("returns the same generic not-found for stale and cross-tenant export ids", async () => {
    const { repository } = harness(
      { data: [], error: null },
      { data: null, error: null },
    );

    await expect(
      repository.getExport(organizationId, exportId),
    ).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("reads the latest export only through an organization-first query", async () => {
    const { repository, exportQuery } = harness(
      { data: [], error: null },
      { data: exportRow, error: null },
    );

    await expect(
      repository.getLatestExport(organizationId),
    ).resolves.toMatchObject({
      id: exportId,
      status: "queued",
    });
    expect(exportQuery.eq).toHaveBeenCalledWith(
      "organization_id",
      organizationId,
    );
    expect(exportQuery.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(exportQuery.limit).toHaveBeenCalledWith(1);
  });

  it("returns an explicit empty latest export without widening tenant scope", async () => {
    await expect(
      harness(
        { data: [], error: null },
        { data: null, error: null },
      ).repository.getLatestExport(organizationId),
    ).resolves.toBeNull();
  });

  it("rejects malformed RPC JSON before it reaches the controller", async () => {
    const { repository } = harness({
      data: [{ outcome: "found", lifecycle: { status: "secret_worker_mode" } }],
      error: null,
    });

    await expect(repository.getLifecycle(organizationId)).rejects.toMatchObject(
      {
        code: "malformed",
      },
    );
  });

  it("parses every read RPC through its strict contract", async () => {
    await expect(
      harness({
        data: [{ outcome: "found", settings }],
        error: null,
      }).repository.getSettings(organizationId),
    ).resolves.toEqual({ outcome: "found", settings });
    const catalog = {
      timezones: ["Asia/Kolkata"],
      notificationChannels: [],
      aiProviders: [],
      dataResidencies: [],
      minimumSessionAgeMinutes: 5,
      maximumSessionAgeMinutes: 60,
    };
    await expect(
      harness({
        data: [{ outcome: "found", catalog }],
        error: null,
      }).repository.getSettingsCatalog(organizationId),
    ).resolves.toEqual({ outcome: "found", catalog });
    await expect(
      harness({
        data: [{ outcome: "found", policies: [policy] }],
        error: null,
      }).repository.getRetentionPolicies(organizationId),
    ).resolves.toEqual({ outcome: "found", policies: [policy] });
    await expect(
      harness({
        data: [{ outcome: "found", lifecycle }],
        error: null,
      }).repository.getLifecycle(organizationId),
    ).resolves.toEqual({ outcome: "found", lifecycle });
  });

  it("executes retention, grant, and lifecycle mutation RPCs", async () => {
    await expect(
      harness({
        data: [{ outcome: "updated", policy }],
        error: null,
      }).repository.updateRetentionPolicy(organizationId, actorId, {
        evidenceClass: "audit_log",
        expectedVersion: 1,
        requestedRetentionDays: 30,
      }),
    ).resolves.toEqual({ outcome: "updated", policy });
    await expect(
      harness({
        data: [
          {
            outcome: "created",
            grant_id: "00000000-0000-4000-8000-000000000005",
            expires_at: "2026-08-10T00:10:00.000Z",
          },
        ],
        error: null,
      }).repository.createReauthenticationGrant(
        organizationId,
        actorId,
        sessionId,
        1,
        "2026-08-10T00:10:00.000Z",
      ),
    ).resolves.toEqual({
      outcome: "created",
      reauthenticationGrantId: "00000000-0000-4000-8000-000000000005",
      expiresAt: "2026-08-10T00:10:00.000Z",
    });
    const common = {
      reauthenticationGrantId: "00000000-0000-4000-8000-000000000005",
      expectedVersion: 1,
    };
    await expect(
      harness({
        data: [{ outcome: "deactivated", lifecycle }],
        error: null,
      }).repository.deactivate(organizationId, actorId, sessionId, {
        ...common,
        confirmation: "DEACTIVATE ORGANIZATION",
      }),
    ).resolves.toEqual({ outcome: "updated", lifecycle });
    await expect(
      harness({
        data: [{ outcome: "scheduled", lifecycle }],
        error: null,
      }).repository.schedulePurge(organizationId, actorId, sessionId, {
        ...common,
        confirmation: "DELETE acme",
      }),
    ).resolves.toEqual({ outcome: "updated", lifecycle });
    await expect(
      harness({
        data: [{ outcome: "recovered", lifecycle }],
        error: null,
      }).repository.recover(organizationId, actorId, sessionId, common),
    ).resolves.toEqual({ outcome: "updated", lifecycle });
  });

  it("rereads the scoped committed export after an idempotent request", async () => {
    const { repository } = harness(
      {
        data: [
          {
            outcome: "replayed",
            export_job_id: exportId,
            export_job: {},
            idempotent: true,
          },
        ],
        error: null,
      },
      { data: exportRow, error: null },
    );

    const result = await repository.requestExport(
      organizationId,
      actorId,
      "00000000-0000-4000-8000-000000000007",
      "a".repeat(64),
      "correlation",
    );
    expect(result.outcome).toBe("replayed");
    if (result.outcome !== "replayed") throw new Error("Expected replay");
    expect(result.export).toMatchObject({ id: exportId, status: "queued" });
    expect(result.idempotent).toBe(true);
  });

  it.each(["not_found", "invalid_request"] as const)(
    "preserves retention mutation %s",
    async (outcome) => {
      await expect(
        harness({
          data: [{ outcome }],
          error: null,
        }).repository.updateRetentionPolicy(organizationId, actorId, {
          evidenceClass: "audit_log",
          expectedVersion: 1,
          requestedRetentionDays: 30,
        }),
      ).resolves.toEqual({ outcome });
    },
  );

  it.each([
    ["idempotency_mismatch", "conflict"],
    ["invalid_request", "invalid_request"],
    ["not_found", "not_found"],
  ] as const)("maps export RPC %s", async (outcome, expected) => {
    await expect(
      harness({ data: [{ outcome }], error: null }).repository.requestExport(
        organizationId,
        actorId,
        "00000000-0000-4000-8000-000000000007",
        "a".repeat(64),
        "correlation",
      ),
    ).resolves.toEqual({ outcome: expected });
  });

  it.each([
    "invalid_grant",
    "invalid_request",
    "conflict",
    "invalid_state",
    "not_found",
  ] as const)("preserves lifecycle failure %s", async (outcome) => {
    await expect(
      harness({ data: [{ outcome }], error: null }).repository.deactivate(
        organizationId,
        actorId,
        sessionId,
        {
          reauthenticationGrantId: "00000000-0000-4000-8000-000000000005",
          expectedVersion: 1,
          confirmation: "DEACTIVATE ORGANIZATION",
        },
      ),
    ).resolves.toEqual({ outcome });
  });

  it.each([
    "getSettings",
    "getSettingsCatalog",
    "getRetentionPolicies",
    "getLifecycle",
  ] as const)(
    "maps %s not-found without parsing payload JSON",
    async (method) => {
      const repository = harness({
        data: [{ outcome: "not_found" }],
        error: null,
      }).repository;

      await expect(repository[method](organizationId)).resolves.toEqual({
        outcome: "not_found",
      });
    },
  );

  it.each([
    ["invalid_catalog", { outcome: "invalid_request" }],
    ["not_found", { outcome: "not_found" }],
  ] as const)("maps settings mutation %s", async (outcome, expected) => {
    if (settings.status !== "configured") throw new Error("Expected settings");
    await expect(
      harness({ data: [{ outcome }], error: null }).repository.updateSettings(
        organizationId,
        actorId,
        sessionId,
        { expectedVersion: 1, values: settings.values },
      ),
    ).resolves.toEqual(expected);
  });

  it("preserves current settings and policy on optimistic conflicts", async () => {
    if (settings.status !== "configured") throw new Error("Expected settings");
    await expect(
      harness({
        data: [{ outcome: "conflict", settings }],
        error: null,
      }).repository.updateSettings(organizationId, actorId, sessionId, {
        expectedVersion: 1,
        values: settings.values,
      }),
    ).resolves.toEqual({ outcome: "conflict", settings });
    await expect(
      harness({
        data: [{ outcome: "conflict", policy }],
        error: null,
      }).repository.updateRetentionPolicy(organizationId, actorId, {
        evidenceClass: "audit_log",
        expectedVersion: 0,
        requestedRetentionDays: 30,
      }),
    ).resolves.toEqual({ outcome: "conflict", policy });
  });

  it("maps completed and verification-failed exports without diagnostics", async () => {
    const completed = harness(
      { data: [], error: null },
      {
        data: {
          ...exportRow,
          status: "completed",
          completed_parts: 1,
          total_parts: 1,
          manifest_format_version: 1,
          manifest_sha256: "a".repeat(64),
          manifest_file_count: 1,
          verified_at: "2026-08-10T00:10:00.000Z",
        },
        error: null,
      },
    ).repository;
    const failed = harness(
      { data: [], error: null },
      {
        data: {
          ...exportRow,
          status: "failed",
          safe_error_code: "verification_failed",
        },
        error: null,
      },
    ).repository;

    await expect(
      completed.getExport(organizationId, exportId),
    ).resolves.toMatchObject({
      outcome: "found",
      value: { status: "completed", manifest: { sha256: "a".repeat(64) } },
    });
    await expect(
      failed.getExport(organizationId, exportId),
    ).resolves.toMatchObject({
      outcome: "found",
      value: {
        status: "failed",
        error: { code: "verification_failed" },
      },
    });
  });

  it("fails closed on provider errors, unknown outcomes, and incomplete rereads", async () => {
    await expect(
      harness({
        data: null,
        error: { message: "private" },
      }).repository.getSettings(organizationId),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      harness({
        data: [{ outcome: "new_secret_mode" }],
        error: null,
      }).repository.getSettings(organizationId),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      harness(
        {
          data: [
            {
              outcome: "created",
              export_job_id: exportId,
              idempotent: false,
            },
          ],
          error: null,
        },
        { data: null, error: null },
      ).repository.requestExport(
        organizationId,
        actorId,
        "00000000-0000-4000-8000-000000000007",
        "a".repeat(64),
        "correlation",
      ),
    ).rejects.toMatchObject({ code: "malformed" });
  });
});
