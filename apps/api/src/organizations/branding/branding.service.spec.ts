import { BrandingService } from "./branding.service";

const value = Object.freeze({ branding: { source: "sentinel" } });

function harness(result: unknown = { ok: true, value }) {
  const useCases = {
    getResolved: jest.fn().mockResolvedValue(result),
    getDraft: jest.fn().mockResolvedValue(result),
    uploadLogo: jest.fn().mockResolvedValue(result),
    renderLogo: jest.fn().mockResolvedValue(result),
    renderPublishedLogo: jest.fn().mockResolvedValue(result),
    saveDraft: jest.fn().mockResolvedValue(result),
    publish: jest.fn().mockResolvedValue(result),
    removeLogo: jest.fn().mockResolvedValue(result),
  };
  return { service: new BrandingService(useCases as never), useCases };
}

describe("BrandingService", () => {
  it("delegates every public branding operation to the application facade", async () => {
    const { service, useCases } = harness();
    const command = { organizationId: "org" } as never;

    await expect(service.resolved(command)).resolves.toBe(value);
    await expect(service.preview(command)).resolves.toBe(value);
    await expect(service.uploadLogo(command)).resolves.toBe(value);
    await expect(service.renderLogo(command)).resolves.toBe(value);
    await expect(service.renderPublishedLogo(command)).resolves.toBe(value);
    await expect(service.saveDraft(command)).resolves.toBe(value);
    await expect(service.publish(command)).resolves.toBe(value);
    await expect(service.removeLogo(command)).resolves.toBe(value);

    for (const mock of Object.values(useCases)) {
      expect(mock.mock.calls).toEqual([[command]]);
    }
  });

  it.each([
    ["invalid_request", 400, "invalid_request"],
    ["scanner_rejected", 400, "scanner_rejected"],
    ["conflict", 409, "conflict"],
    ["not_found", 404, "not_found"],
    ["unavailable", 503, "unavailable"],
    ["malformed_provider", 502, "malformed_provider"],
  ] as const)(
    "maps %s to a safe HTTP %i response",
    async (code, status, responseCode) => {
      const { service } = harness({ ok: false, error: { code } });

      await expect(
        service.resolved({ organizationId: "org", actorId: "actor" }),
      ).rejects.toMatchObject({
        status,
        response: {
          message: "Organization branding request could not be completed.",
          code: responseCode,
        },
      });
    },
  );
});
