import type { RequestUser } from "../../auth/auth.types";
import { ReportsUseCases } from "./reports.use-cases";
import { ReportAccessDeniedError } from "../domain/report.errors";
import type { ReportsPort } from "./reports.port";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  isActive: true,
} as RequestUser;
const id = "44444444-4444-4444-8444-444444444444";

describe("ReportsUseCases", () => {
  const input = {
    config: { report: { kind: "list", source: "products.registry" } },
    idempotencyKey: id,
  } as Parameters<ReportsPort["create"]>[2];
  it("denies requests without a verified active tenant session", () => {
    const list = jest.fn();
    const repository = { list } as unknown as ReportsPort;
    const useCases = new ReportsUseCases(repository, { can: jest.fn() });
    expect(() =>
      useCases.list({ ...user, sessionId: undefined }, { limit: 25 }),
    ).toThrow(ReportAccessDeniedError);
    expect(list).not.toHaveBeenCalled();
  });
  it("passes verified org and actor to repository", async () => {
    const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const repository = { list } as unknown as ReportsPort;
    const useCases = new ReportsUseCases(repository, { can: jest.fn() });
    await useCases.list(user, { limit: 25 });
    expect(list).toHaveBeenCalledWith(
      user.organizationId,
      expect.objectContaining({ actorId: user.id, sessionId: user.sessionId }),
      { limit: 25 },
    );
  });
  it("rejects writes when source permission is absent", async () => {
    const create = jest.fn();
    const repository = { create } as unknown as ReportsPort;
    const useCases = new ReportsUseCases(repository, {
      can: jest.fn().mockResolvedValue(false),
    });
    await expect(useCases.create(user, input)).rejects.toBeInstanceOf(
      ReportAccessDeniedError,
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("uses the verified tenant and actor for every read boundary", async () => {
    const methods = [
      "get",
      "list",
      "getRun",
      "listRuns",
      "recipients",
      "manifest",
      "getEmailPreference",
      "listAdministration",
    ] as const;
    const calls = Object.fromEntries(
      methods.map((name) => [name, jest.fn().mockResolvedValue({})]),
    );
    const repository = calls as unknown as ReportsPort;
    const cases = new ReportsUseCases(repository, { can: jest.fn() });
    await Promise.all([
      cases.get(user, id),
      cases.list(user, { limit: 25 }),
      cases.getRun(user, id),
      cases.listRuns(user, { limit: 25 }),
      cases.recipients(user, { limit: 25 }),
      cases.manifest(user, id, id),
      cases.getEmailPreference(user),
      cases.listAdministration(user, { limit: 25 }),
    ]);
    for (const name of methods) {
      const call = (calls[name] as jest.Mock).mock.calls[0] as unknown[];
      expect(call.slice(0, 2)).toEqual([
        user.organizationId,
        expect.objectContaining({
          actorId: user.id,
          sessionId: user.sessionId,
        }),
      ]);
    }
  });
  it("denies administration to ordinary members", () => {
    const cases = new ReportsUseCases({} as ReportsPort, { can: jest.fn() });
    expect(() =>
      cases.listAdministration({ ...user, role: "member" }, { limit: 25 }),
    ).toThrow(ReportAccessDeniedError);
    expect(() =>
      cases.adminPause({ ...user, role: "member" }, id, {
        expectedVersion: 1,
        idempotencyKey: id,
      }),
    ).toThrow(ReportAccessDeniedError);
  });
  it("checks current source access before preview and activation", async () => {
    const preview = jest.fn();
    const mutate = jest.fn();
    const get = jest.fn().mockResolvedValue({ data: { config: input.config } });
    const cases = new ReportsUseCases(
      { get, preview, mutate } as unknown as ReportsPort,
      { can: jest.fn().mockResolvedValue(false) },
    );
    const command = { expectedVersion: 1, idempotencyKey: id };
    await expect(cases.preview(user, id, command)).rejects.toBeInstanceOf(
      ReportAccessDeniedError,
    );
    await expect(
      cases.mutate(user, id, "activate", command),
    ).rejects.toBeInstanceOf(ReportAccessDeniedError);
    expect(preview).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("binds grants to a random token digest and rejects missing download cookies", async () => {
    const grant = jest.fn().mockResolvedValue({ data: { grantId: id } });
    const download = jest.fn().mockResolvedValue({});
    const cases = new ReportsUseCases(
      { grant, download } as unknown as ReportsPort,
      { can: jest.fn() },
    );
    const issued = await cases.grant(user, id, id, id);
    expect(issued.cookieValue).toMatch(/^[a-f0-9]{64}$/);
    expect(grant).toHaveBeenCalledWith(
      user.organizationId,
      expect.anything(),
      id,
      id,
      id,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(() => cases.download(user, id, id, id, undefined)).toThrow(
      ReportAccessDeniedError,
    );
    expect(download).not.toHaveBeenCalled();
    await cases.download(user, id, id, id, issued.cookieValue);
    expect(download).toHaveBeenCalledWith(
      user.organizationId,
      expect.anything(),
      id,
      id,
      id,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
  it("permits authorized owner commands and passes immutable command inputs", async () => {
    const methods = [
      "create",
      "update",
      "get",
      "preview",
      "mutate",
      "replay",
      "setEmailPreference",
      "adminPause",
    ] as const;
    const calls = Object.fromEntries(
      methods.map((name) => [name, jest.fn().mockResolvedValue({})]),
    );
    calls.get = jest.fn().mockResolvedValue({ data: { config: input.config } });
    const cases = new ReportsUseCases(calls as unknown as ReportsPort, {
      can: jest.fn().mockResolvedValue(true),
    });
    const command = { expectedVersion: 1, idempotencyKey: id };
    await cases.create(user, input);
    await cases.update(user, id, { ...input, ...command });
    await cases.preview(user, id, command);
    for (const operation of ["activate", "pause", "resume", "archive"] as const)
      await cases.mutate(user, id, operation, command);
    await cases.replay(user, id, command);
    await cases.setEmailPreference(user, { ...command, mode: "off" });
    await cases.adminPause(user, id, command);
    for (const name of methods)
      expect((calls[name] as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect(
      (calls.mutate as jest.Mock).mock.calls.map((args: unknown[]) => args[3]),
    ).toEqual(["activate", "pause", "resume", "archive"]);
  });
});
