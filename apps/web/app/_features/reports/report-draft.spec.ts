// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readReportDraftSeed, storeReportDraftSeed } from "./report-draft";

afterEach(() => sessionStorage.clear());

describe("report draft handoff", () => {
  it("strips paging state and binds a member selection to the session scope", () => {
    const key = storeReportDraftSeed(
      {
        source: "products.registry",
        format: "csv",
        context: {},
        filters: { page: 4, pageSize: 25 },
      },
      "org:user",
    );
    expect(readReportDraftSeed(key, "org:user")).toMatchObject({
      kind: "list",
      source: "products.registry",
      filters: {},
    });
    expect(readReportDraftSeed(key, "other:user")).toBeNull();
  });

  it("rejects unsupported sources before writing to storage", () => {
    expect(() =>
      storeReportDraftSeed({ source: "unknown", format: "csv" }, "org:user"),
    ).toThrow();
    expect(sessionStorage.length).toBe(0);
  });

  it("accepts the product registry's actual export props, including absent search text", () => {
    const key = storeReportDraftSeed(
      {
        source: "products.registry",
        format: "csv",
        context: {},
        filters: { page: 1, pageSize: 25, q: undefined, archived: false },
        columns: [
          "name",
          "internalCode",
          "productType",
          "responsibleOwnerId",
          "legalEntity.id",
        ],
      },
      "org:user",
    );
    expect(readReportDraftSeed(key, "org:user")).toMatchObject({
      kind: "list",
      source: "products.registry",
      filters: { archived: false },
      columns: [
        "name",
        "internalCode",
        "productType",
        "responsibleOwnerId",
        "legalEntity.id",
      ],
    });
  });

  it("ignores malformed or tampered local handoff records", () => {
    expect(readReportDraftSeed("../other", "org:user")).toBeNull();
    const key = "11111111-1111-4111-8111-111111111111";
    sessionStorage.setItem(`cra:scheduled-report-draft:${key}`, "not json");
    expect(readReportDraftSeed(key, "org:user")).toBeNull();
    sessionStorage.setItem(
      `cra:scheduled-report-draft:${key}`,
      JSON.stringify({ scope: "org:user", report: { source: "unknown" } }),
    );
    expect(readReportDraftSeed(key, "org:user")).toBeNull();
  });
});
