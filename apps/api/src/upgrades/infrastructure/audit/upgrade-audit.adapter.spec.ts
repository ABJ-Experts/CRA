import { UpgradeAuditAdapter } from "./upgrade-audit.adapter";
import type { JournalRecord } from "../journal/upgrade-host-journal";

describe("durable upgrade audit projection", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const record = { runId, sequence: 9, data: {} } as JournalRecord;
  const fact = {
    record,
    actorId,
    action: "upgrade.migrated",
    outcome: "completed" as const,
    metadata: {
      stage: "migrated",
      version: 9,
      password: "secret",
      reasonCode: "/host/private",
      count: 3,
    },
  };
  it("awaits journal authentication and uses deterministic keys, operator actor and safe metadata", async () => {
    const rpc = jest.fn(() =>
      Promise.resolve({
        data: [{ outcome: "inserted", audit_id: runId }],
        error: null,
      }),
    );
    const authenticate = jest.fn(() => Promise.resolve(undefined));
    const adapter = new UpgradeAuditAdapter({ rpc }, authenticate);
    expect(await adapter.append(fact)).toEqual({
      outcome: "inserted",
      auditId: runId,
    });
    expect(authenticate).toHaveBeenCalledWith(fact);
    expect(rpc).toHaveBeenCalledWith(
      "m13_01_append_audit_event",
      expect.objectContaining({
        p_event_key: `upgrade:${runId}:9`,
        p_actor_type: "operator",
        p_actor_id: actorId,
        p_organization_id: null,
        p_after_redacted: {
          stage: "migrated",
          version: 9,
          reasonCode: "[REDACTED]",
          count: 3,
        },
      }),
    );
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", audit_id: runId }],
      error: null,
    });
    expect((await adapter.append(fact)).outcome).toBe("replayed");
  });
  it("fails closed before writing unauthenticated journal or unsafe envelope", async () => {
    const rpc = jest.fn();
    const adapter = new UpgradeAuditAdapter({ rpc }, async () => {
      await Promise.resolve();
      throw Error("unauthenticated");
    });
    await expect(adapter.append(fact)).rejects.toThrow("unauthenticated");
    await expect(
      adapter.append({ ...fact, actorId: "system" }),
    ).rejects.toThrow("invalid");
    await expect(
      adapter.append({ ...fact, action: "private/path" }),
    ).rejects.toThrow("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    [{ outcome: "conflict", audit_id: runId }],
    [{ outcome: "inserted", audit_id: "bad" }],
  ])(
    "fails closed on missing, conflicting or malformed durable receipts %s",
    async (data) => {
      const adapter = new UpgradeAuditAdapter(
        { rpc: () => Promise.resolve({ data, error: null }) },
        () => Promise.resolve(undefined),
      );
      await expect(adapter.append(fact)).rejects.toThrow("unavailable");
    },
  );
});
