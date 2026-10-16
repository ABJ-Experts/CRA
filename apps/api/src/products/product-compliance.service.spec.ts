import { ProductComplianceService } from "./product-compliance.service";

describe("ProductComplianceService", () => {
  it.each([
    ["invalid_request", 400],
    ["not_found", 404],
    ["conflict", 409],
    ["invalid_state", 409],
    ["incomplete", 409],
    ["blocked", 409],
    ["unavailable", 503],
    ["malformed_provider", 502],
  ] as const)(
    "maps %s to HTTP %i without provider details",
    async (code, status) => {
      const useCases = {
        listAssessments: jest
          .fn()
          .mockResolvedValue({ ok: false, error: { code } }),
      };
      const service = new ProductComplianceService(useCases as never);

      await expect(
        service.listAssessments({
          organizationId: "organization",
          actorId: "actor",
          productId: "product",
          query: {} as never,
        }),
      ).rejects.toMatchObject({ status, response: { code } });
    },
  );
});
