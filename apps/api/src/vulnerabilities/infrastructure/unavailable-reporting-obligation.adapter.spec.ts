import { UnavailableReportingObligationAdapter } from "./unavailable-reporting-obligation.adapter";

describe("UnavailableReportingObligationAdapter", () => {
  it("never creates or submits an obligation while M6 is unavailable", async () => {
    const adapter = new UnavailableReportingObligationAdapter();

    await expect(
      adapter.openOrLink({
        organizationId: "00000000-0000-4000-8000-000000000001",
        actorId: "00000000-0000-4000-8000-000000000002",
        alertId: "00000000-0000-4000-8000-000000000003",
        idempotencyKey: "00000000-0000-4000-8000-000000000004",
      }),
    ).resolves.toEqual({ outcome: "downstream_unavailable" });
  });
});
