import { SupabaseLicenseUsageRepository } from "./supabase-license-usage.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { LicenseUsageSnapshot } from "@repo/contracts/licensing/types";

const org = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const command = {
  expectedLicenseVersion: 1,
  expectedMeterVersion: 2,
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
  requestDigest: "a".repeat(64),
};
const projection = {
  outcome: "ready",
  organizationId: org,
  observedAt: "2026-10-13T15:30:00+05:30",
  licenseVersion: 1,
  policyRevision: 1,
  issuanceSequence: 1,
  meterVersion: 2,
  reconciledAt: "2026-10-13T10:00:00Z",
  components: {
    activeMembers: 1,
    reservedInvitations: 2,
    products: 3,
    storageBytes: null,
    storageReservedBytes: 5,
    protectedStorageBytes: 6,
  },
  availability: {
    seats: "ready",
    products: "ready",
    storage: "unavailable",
    protected_storage: "ready",
  },
  reasons: {
    seats: [],
    products: [],
    storage: ["accounting_unavailable"],
    protected_storage: [],
  },
};
function setup() {
  const rpc = jest.fn().mockResolvedValue({ data: projection, error: null });
  const repository = new SupabaseLicenseUsageRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  return { rpc, repository };
}
describe("SupabaseLicenseUsageRepository", () => {
  it("reads only the verified organization/actor projection and normalizes PostgreSQL timestamp offsets", async () => {
    const { repository, rpc } = setup();
    const result = await repository.read(org, actor, 1);
    expect(rpc).toHaveBeenCalledWith("m15_02_read_usage", {
      p_organization_id: org,
      p_actor_user_id: actor,
      p_expected_license_version: 1,
    });
    expect(result).toMatchObject({
      observedAt: "2026-10-13T10:00:00.000Z",
      reconciledAt: "2026-10-13T10:00:00.000Z",
      components: { storageBytes: null },
    });
  });
  it("checks receipt authority before returning the original immutable response", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({ data: { outcome: "absent" }, error: null });
    expect(await repository.receipt(org, actor, "export", command)).toEqual({
      outcome: "absent",
    });
    expect(rpc).toHaveBeenCalledWith("m15_02_usage_receipt", {
      p_organization_id: org,
      p_actor_user_id: actor,
      p_operation: "export",
      p_idempotency_key: command.idempotencyKey,
      p_request_digest: command.requestDigest,
    });
  });
  it("supplies both optimistic versions and safe snapshot to the atomic export", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({ data: { outcome: "conflict" }, error: null });
    const snapshot = {} as LicenseUsageSnapshot;
    expect(await repository.export(org, actor, command, snapshot)).toEqual({
      outcome: "conflict",
    });
    expect(rpc).toHaveBeenCalledWith("m15_02_export_usage", {
      p_organization_id: org,
      p_actor_user_id: actor,
      p_expected_license_version: 1,
      p_expected_meter_version: 2,
      p_idempotency_key: command.idempotencyKey,
      p_request_digest: command.requestDigest,
      p_snapshot: snapshot,
    });
  });
  it("returns a bounded flat repair receipt and supplies authoritative identity/versions", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({
      data: {
        outcome: "reconciled",
        auditEventId: org,
        meterVersion: 3,
        checked: 100,
        repaired: 20,
        released: 10,
        unresolved: 2,
        completedAt: projection.observedAt,
        replayed: false,
      },
      error: null,
    });
    expect(await repository.reconcile(org, actor, command)).toMatchObject({
      checked: 100,
      completedAt: "2026-10-13T10:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "m15_02_reconcile_usage",
      expect.objectContaining({
        p_organization_id: org,
        p_actor_user_id: actor,
        p_expected_meter_version: 2,
      }),
    );
  });
  it.each([
    { code: "42501", message: "private path" },
    { code: "57014", message: "query timed out" },
    { code: "other", message: "token" },
    "failure",
  ])("maps SQL failures without database details", async (error) => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({ data: null, error });
    await expect(repository.read(org, actor, null)).rejects.toMatchObject({
      status: typeof error === "object" && error.code === "42501" ? 403 : 503,
    });
    try {
      await repository.read(org, actor, null);
    } catch (error) {
      expect(JSON.stringify(error)).not.toMatch(
        /private path|query timed out|token/,
      );
    }
  });
  it("maps thrown transport/admin failures to a stable outage", async () => {
    const { repository, rpc } = setup();
    rpc.mockRejectedValue(new Error("provider token"));
    await expect(
      repository.reconcile(org, actor, command),
    ).rejects.toMatchObject({ code: "license_usage_unavailable", status: 503 });
  });
  it.each([
    null,
    [],
    {
      ...projection,
      components: {
        ...projection.components,
        products: Number.MAX_SAFE_INTEGER + 1,
      },
    },
    { ...projection, observedAt: "not-a-time" },
    { ...projection, observedAt: "2026" },
    { ...projection, token: "secret" },
  ])("rejects malformed or private database responses", async (data) => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({ data, error: null });
    await expect(repository.read(org, actor, null)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("rejects a repair exceeding the bounded candidate count", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({
      data: {
        outcome: "reconciled",
        auditEventId: org,
        meterVersion: 3,
        checked: 101,
        repaired: 20,
        released: 10,
        unresolved: 2,
        completedAt: projection.observedAt,
        replayed: false,
      },
      error: null,
    });
    await expect(
      repository.reconcile(org, actor, command),
    ).rejects.toMatchObject({ status: 503 });
  });
});
