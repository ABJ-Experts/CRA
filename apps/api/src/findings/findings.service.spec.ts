import { FindingsService } from "./findings.service";

const success = Object.freeze({ ok: true as const, value: { value: true } });
const failure = (code: string) =>
  Object.freeze({ ok: false as const, error: { code } });

describe("FindingsService", () => {
  it("unwraps every successful finding use case without changing its payload", async () => {
    const useCases = {
      registerSource: jest.fn().mockResolvedValue(success),
      updateSource: jest.fn().mockResolvedValue(success),
      getProductImpactSummary: jest.fn().mockResolvedValue(success),
      createProductImpactOverride: jest.fn().mockResolvedValue(success),
      endProductImpactOverride: jest.fn().mockResolvedValue(success),
    };
    const service = new FindingsService(useCases as never);

    await expect(service.registerSource({} as never)).resolves.toEqual(
      success.value,
    );
    await expect(service.updateSource({} as never)).resolves.toEqual(
      success.value,
    );
    await expect(service.getProductImpactSummary({} as never)).resolves.toEqual(
      success.value,
    );
    await expect(
      service.createProductImpactOverride({} as never),
    ).resolves.toEqual(success.value);
    await expect(
      service.endProductImpactOverride({} as never),
    ).resolves.toEqual(success.value);
  });

  it.each([
    ["invalid_request", 400],
    ["not_found", 404],
    ["conflict", 409],
    ["idempotency_mismatch", 409],
    ["unavailable", 503],
    ["malformed_provider", 502],
  ])("maps %s to the stable HTTP status", async (code, status) => {
    const useCases = {
      registerSource: jest.fn().mockResolvedValue(failure(code)),
    };

    await expect(
      new FindingsService(useCases as never).registerSource({} as never),
    ).rejects.toMatchObject({ status });
  });
});
