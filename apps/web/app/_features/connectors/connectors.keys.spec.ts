import { describe, expect, it } from "vitest";
import { connectorKeys } from "./connectors.keys";

describe("connector organization cache isolation", () => {
  it("never aliases the same connector or catalogue between organizations", () => {
    expect(
      connectorKeys.scoped("org-a", connectorKeys.detail("same-id")),
    ).not.toEqual(
      connectorKeys.scoped("org-b", connectorKeys.detail("same-id")),
    );
    expect(connectorKeys.organization("org-a")).toEqual([
      "connectors",
      "org-a",
    ]);
  });
});
