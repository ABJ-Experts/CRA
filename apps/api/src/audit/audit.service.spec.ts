import { Logger } from "@nestjs/common";

import { AuditService, type AuditEntry } from "./audit.service";

const completeEntry: AuditEntry = Object.freeze({
  organizationId: "org-1",
  userId: "user-1",
  actorEmail: "owner@cra.test",
  action: "role.updated",
  entityType: "role",
  entityId: "role-1",
  changes: { name: "Support", active: true, count: 2, removed: null },
  ip: "203.0.113.5",
  userAgent: "coverage-test",
});

async function flushWrites(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture(insertResult: unknown = { error: null }) {
  const insert = jest.fn().mockResolvedValue(insertResult);
  const from = jest.fn().mockReturnValue({ insert });
  const admin = jest.fn().mockReturnValue({ from });
  const service = new AuditService({ admin } as never);
  return { service, admin, from, insert };
}

describe("AuditService", () => {
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes the complete immutable audit record asynchronously", async () => {
    const { service, admin, from, insert } = fixture();

    expect(service.log(completeEntry)).toBeUndefined();
    await flushWrites();

    expect(admin).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("audit_logs");
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      user_id: "user-1",
      actor_email: "owner@cra.test",
      action: "role.updated",
      entity_type: "role",
      entity_id: "role-1",
      changes: completeEntry.changes,
      ip_address: "203.0.113.5",
      user_agent: "coverage-test",
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("normalizes omitted optional values to null", async () => {
    const { service, insert } = fixture();

    service.log({ organizationId: null, userId: null, action: "system.ready" });
    await flushWrites();

    expect(insert).toHaveBeenCalledWith({
      organization_id: null,
      user_id: null,
      actor_email: null,
      action: "system.ready",
      entity_type: null,
      entity_id: null,
      changes: null,
      ip_address: null,
      user_agent: null,
    });
  });

  it("logs a failed insert without creating an unhandled rejection", async () => {
    const { service } = fixture({ error: { message: "write denied" } });

    service.log(completeEntry);
    await flushWrites();

    expect(loggerError).toHaveBeenCalledWith(
      "Audit write failed: write denied",
    );
  });

  it.each([
    [new Error("connection lost"), "connection lost"],
    ["connection lost", "connection lost"],
  ])(
    "logs a thrown write failure without rejecting",
    async (failure, message) => {
      const insert = jest.fn().mockRejectedValue(failure);
      const service = new AuditService({
        admin: () => ({ from: () => ({ insert }) }),
      } as never);

      service.log(completeEntry);
      await flushWrites();

      expect(loggerError).toHaveBeenCalledWith(`Audit write threw: ${message}`);
    },
  );
});
