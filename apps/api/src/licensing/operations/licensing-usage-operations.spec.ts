import { getLicenceRouteOperation } from "./licence-operation.registry";

describe("usage operation availability", () => {
  it.each([
    ["getUsage", "protective", false],
    ["exportUsage", "evidence", true],
    ["reconcileUsage", "protective", true],
  ])(
    "keeps %s available independently of expiry",
    (handler, kind, mutation) => {
      expect(
        getLicenceRouteOperation("LicensingUsageController", handler),
      ).toEqual(
        expect.objectContaining({ kind, mutation, identity: "member" }),
      );
    },
  );
});
