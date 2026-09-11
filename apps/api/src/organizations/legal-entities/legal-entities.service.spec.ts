import { LegalEntitiesService } from "./legal-entities.service";

const value = Object.freeze({ legalEntity: { id: "entity" } });

function harness(result: unknown = { ok: true, value }) {
  const useCases = {
    list: jest.fn().mockResolvedValue(result),
    get: jest.fn().mockResolvedValue(result),
    create: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockResolvedValue(result),
    transition: jest.fn().mockResolvedValue(result),
  };
  return { service: new LegalEntitiesService(useCases as never), useCases };
}

describe("LegalEntitiesService", () => {
  it("delegates every public administration operation to the application facade", async () => {
    const { service, useCases } = harness();
    const command = { organizationId: "org" } as never;

    await expect(service.list("org", "actor")).resolves.toBe(value);
    await expect(service.get(command)).resolves.toBe(value);
    await expect(service.create(command)).resolves.toBe(value);
    await expect(service.update(command)).resolves.toBe(value);
    await expect(service.transition(command)).resolves.toBe(value);

    for (const mock of Object.values(useCases)) {
      expect(mock.mock.calls).toHaveLength(1);
    }
  });

  it.each([
    ["invalid_request", 400, "invalid_request"],
    ["conflict", 409, "conflict"],
    ["not_found", 404, "not_found"],
    ["invalid_state", 409, "invalid_state"],
    ["dependency_blocked", 409, "dependency_blocked"],
    ["inactive", 409, "inactive"],
    ["incomplete", 409, "incomplete"],
    ["unavailable", 503, "unavailable"],
    ["malformed_provider", 502, "malformed_provider"],
  ] as const)("maps %s to HTTP %i", async (code, status, responseCode) => {
    const { service } = harness({ ok: false, error: { code } });

    await expect(service.list("org", "actor")).rejects.toMatchObject({
      status,
      response: { code: responseCode },
    });
  });

  it("returns only safe OCC and dependency blocker details", async () => {
    const { service: conflict } = harness({
      ok: false,
      error: { code: "conflict", current: value.legalEntity },
    });
    await expect(conflict.list("org", "actor")).rejects.toMatchObject({
      response: { code: "conflict", current: value.legalEntity },
    });

    const { service: blocked } = harness({
      ok: false,
      error: { code: "dependency_blocked", reason: "legal_holds" },
    });
    await expect(blocked.list("org", "actor")).rejects.toMatchObject({
      response: { code: "dependency_blocked", reason: "legal_holds" },
    });
  });
});
