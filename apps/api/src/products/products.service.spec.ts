import { ProductsService } from "./products.service";

function harness(
  result: unknown = { ok: true, value: { product: { id: "product" } } },
) {
  const useCases = Object.fromEntries(
    [
      "list",
      "get",
      "create",
      "update",
      "assignLegalEntity",
      "archive",
      "listReleases",
      "getRelease",
      "createRelease",
      "updateRelease",
      "archiveRelease",
      "listMemberStates",
      "getReleaseMarketAvailability",
      "addReleaseMarketAvailability",
      "removeReleaseMarketAvailability",
      "correctReleaseMarketAvailability",
      "transitionReleaseLifecycle",
      "correctPlacedOnMarketDate",
      "getReleaseLifecycleTimeline",
    ].map((name) => [name, jest.fn().mockResolvedValue(result)]),
  );
  return { service: new ProductsService(useCases as never), useCases };
}

describe("ProductsService", () => {
  it.each([
    ["invalid_request", 400],
    ["not_found", 404],
    ["conflict", 409],
    ["invalid_state", 409],
    ["dependency_blocked", 409],
    ["inactive", 409],
    ["incomplete", 409],
    ["invalid_transition", 409],
    ["placement_requires_placed_on_market_at", 409],
    ["placement_requires_active_market_availability", 409],
    ["placed_on_market_date_not_set", 409],
    ["member_state_unavailable", 409],
    ["market_availability_not_found", 404],
    ["unavailable", 503],
    ["malformed_provider", 502],
  ] as const)(
    "maps %s to HTTP %i without exposing provider details",
    async (code, status) => {
      const { service } = harness({ ok: false, error: { code } });
      await expect(
        service.list("org", "actor", {} as never),
      ).rejects.toMatchObject({ status, response: { code } });
    },
  );

  it("preserves only the current resource in an optimistic-concurrency conflict", async () => {
    const current = { id: "product" };
    const { service } = harness({
      ok: false,
      error: { code: "conflict", current },
    });
    await expect(
      service.list("org", "actor", {} as never),
    ).rejects.toMatchObject({ response: { code: "conflict", current } });
  });
});
