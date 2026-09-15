import { TenantAdministrationService } from "./tenant-administration.service";

const value = Object.freeze({ ok: true });

function harness(result: unknown = { ok: true, value }) {
  const useCases = {
    settings: jest.fn().mockResolvedValue(result),
    settingsCatalog: jest.fn().mockResolvedValue(result),
    updateSettings: jest.fn().mockResolvedValue(result),
    retention: jest.fn().mockResolvedValue(result),
    updateRetention: jest.fn().mockResolvedValue(result),
    requestExport: jest.fn().mockResolvedValue(result),
    exportStatus: jest.fn().mockResolvedValue(result),
    latestExport: jest.fn().mockResolvedValue(result),
    downloadExport: jest.fn().mockResolvedValue(result),
    lifecycle: jest.fn().mockResolvedValue(result),
    reauthenticate: jest.fn().mockResolvedValue(result),
    deactivate: jest.fn().mockResolvedValue(result),
    schedulePurge: jest.fn().mockResolvedValue(result),
    recover: jest.fn().mockResolvedValue(result),
  };
  return {
    service: new TenantAdministrationService(useCases as never),
    useCases,
  };
}

describe("TenantAdministrationService", () => {
  it("delegates every route operation to the application facade", async () => {
    const { service, useCases } = harness();
    const command = { organizationId: "org" } as never;

    await expect(service.settings("org")).resolves.toBe(value);
    await expect(service.settingsCatalog("org")).resolves.toBe(value);
    await expect(service.updateSettings(command)).resolves.toBe(value);
    await expect(service.retention("org")).resolves.toBe(value);
    await expect(service.updateRetention(command)).resolves.toBe(value);
    await expect(service.requestExport(command)).resolves.toBe(value);
    await expect(service.exportStatus(command)).resolves.toBe(value);
    await expect(service.latestExport("org")).resolves.toBe(value);
    await expect(service.downloadExport(command)).resolves.toBe(value);
    await expect(service.lifecycle("org")).resolves.toBe(value);
    await expect(service.reauthenticate(command)).resolves.toBe(value);
    await expect(service.deactivate(command)).resolves.toBe(value);
    await expect(service.schedulePurge(command)).resolves.toBe(value);
    await expect(service.recover(command)).resolves.toBe(value);

    for (const mock of Object.values(useCases)) {
      expect(mock.mock.calls).toHaveLength(1);
    }
  });

  it.each([
    ["invalid_request", 400, "invalid_request"],
    ["mfa_not_ready", 400, "mfa_not_ready"],
    ["conflict", 409, "conflict"],
    ["not_found", 404, "not_found"],
    ["forbidden", 403, "forbidden"],
    ["invalid_grant", 403, "invalid_grant"],
    ["mfa_required", 403, "mfa_required"],
    ["invalid_state", 409, "invalid_state"],
    ["unavailable", 503, "unavailable"],
    ["malformed_provider", 502, "malformed_provider"],
  ] as const)("maps %s to HTTP %i", async (code, status, responseCode) => {
    const { service } = harness({ ok: false, error: { code } });

    await expect(service.settings("org")).rejects.toMatchObject({
      status,
      response: { code: responseCode },
    });
  });

  it("preserves only contract-safe conflict details", async () => {
    const current = { status: "unconfigured", version: 0, values: null };
    const { service } = harness({
      ok: false,
      error: { code: "conflict", current },
    });

    await expect(service.settings("org")).rejects.toMatchObject({
      response: { code: "conflict", current },
    });
  });
});
