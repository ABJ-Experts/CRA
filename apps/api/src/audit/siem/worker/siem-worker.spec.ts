import type { SiemSendInput } from "../application/siem-transport.port";
import { SiemWorker } from "./siem-worker";
describe("SIEM worker fencing", () => {
  const claim = {
    organizationId: "10000000-0000-4000-8000-000000000001",
    deliveryId: "delivery",
    destinationId: "destination",
    leaseToken: "lease",
    version: 1,
    workerId: "worker",
    payloadBytes: JSON.stringify({
      schemaVersion: 1,
      eventId: "10000000-0000-4000-8000-000000000001",
      organizationId: "10000000-0000-4000-8000-000000000001",
      occurredAt: "2026-10-07T00:00:00Z",
      eventClass: "organization",
      action: "organization.update",
      outcome: "completed",
      actorType: "user",
      actorId: null,
      resourceType: "organization",
      resourceId: null,
      correlationId: null,
      chainSequence: "1",
    }),
    eventId: "10000000-0000-4000-8000-000000000001",
    protocol: "https",
    endpoint: "https://collector.test",
    format: "json",
    credentials: {},
    credentialId: "credential",
    credentialRevision: 1,
  };
  const repository = {
    stage: jest.fn(),
    claim: jest.fn(),
    authorize: jest.fn(),
    complete: jest.fn(),
  };
  const transport = { send: jest.fn() };
  const vault = { decrypt: jest.fn() };
  const worker = new SiemWorker(
    repository,
    transport as never,
    vault as never,
    "worker",
  );
  beforeEach(() => {
    jest.clearAllMocks();
    repository.claim.mockResolvedValue(claim);
    repository.authorize.mockResolvedValue(claim);
    vault.decrypt.mockReturnValue({ kind: "bearer", token: "secret" });
    transport.send.mockImplementation(async (input: SiemSendInput) => {
      await input.beforeSend?.();
      return {
        outcome: "accepted",
        status: 202,
        category: null,
        code: null,
        retryAfterSeconds: null,
        durationMs: 1,
        responseBytes: 0,
      };
    });
  });
  it("checks authority before decrypt and immediately before network send", async () => {
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(repository.authorize).toHaveBeenCalledTimes(2);
    expect(repository.complete).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({ state: "accepted" }),
    );
  });
  it("never sends revoked work", async () => {
    repository.authorize.mockResolvedValue(null);
    await expect(worker.runOnce()).resolves.toBe("paused");
    expect(transport.send).not.toHaveBeenCalled();
    expect(vault.decrypt).not.toHaveBeenCalled();
  });
  it("idle cycles still stage durable source references", async () => {
    repository.claim.mockResolvedValue(null);
    await expect(worker.runOnce()).resolves.toBe("idle");
    expect(repository.stage).toHaveBeenCalledWith("worker");
  });
  it("marks syslog success as unacknowledged", async () => {
    transport.send.mockResolvedValue({
      outcome: "sent_unacknowledged",
      status: null,
      category: null,
      code: null,
      retryAfterSeconds: null,
      durationMs: 1,
      responseBytes: 0,
    });
    await worker.runOnce();
    expect(repository.complete).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({ state: "sent_unacknowledged" }),
    );
  });
  it("sanitizes thrown transport or vault exceptions", async () => {
    transport.send.mockRejectedValue(new Error("secret bearer"));
    await worker.runOnce();
    expect(repository.complete).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        state: "retry",
        code: "transport_unavailable",
      }),
    );
  });
  it.each([true, false])(
    "classifies explicit transport retryability %s",
    async (retryable) => {
      transport.send.mockResolvedValue({
        outcome: "failed",
        retryable,
        status: 503,
        code: "collector_unavailable",
        durationMs: 1,
        retryAfterSeconds: 5,
      });
      await worker.runOnce();
      expect(repository.complete).toHaveBeenCalledWith(
        claim,
        expect.objectContaining({ state: retryable ? "retry" : "failed" }),
      );
    },
  );
  it("fences rotated credentials", async () => {
    repository.authorize.mockResolvedValue({ ...claim, credentialRevision: 2 });
    await expect(worker.runOnce()).resolves.toBe("paused");
    expect(vault.decrypt).not.toHaveBeenCalled();
  });
  it("checks changed authority immediately before dispatch", async () => {
    repository.authorize
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(null);
    transport.send.mockImplementation(async (input: SiemSendInput) => {
      expect(await input.beforeSend?.()).toBe(false);
      return {
        outcome: "failed",
        retryable: false,
        status: null,
        code: "authorization_changed",
        durationMs: 0,
        retryAfterSeconds: null,
      };
    });
    await worker.runOnce();
  });
  it("supports generated worker identity", () => {
    expect(
      new SiemWorker(repository as never, transport as never, vault as never),
    ).toBeDefined();
  });
  it("never forwards a provider payload from another tenant", async () => {
    repository.authorize.mockResolvedValue({
      ...claim,
      payloadBytes: JSON.stringify({
        ...(JSON.parse(claim.payloadBytes) as object),
        organizationId: "10000000-0000-4000-8000-000000000099",
      }),
    });
    await worker.runOnce();
    expect(transport.send).not.toHaveBeenCalled();
  });
});
