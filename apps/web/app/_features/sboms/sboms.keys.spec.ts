import { describe, expect, it } from "vitest";
import { getSbomKeys } from "./sboms.keys";

describe("tenant-scoped SBOM cache", () => {
  it("partitions every shared prefix and record read by organization", () => {
    const a = getSbomKeys("org-a");
    const b = getSbomKeys("org-b");
    expect(a.ciCredentials).not.toEqual(b.ciCredentials);
    expect(a.supplierRequestList({})).not.toEqual(b.supplierRequestList({}));
    expect(a.document("same-id")).not.toEqual(b.document("same-id"));
    expect(a.all).toEqual(["sboms", "organization", "org-a"]);
  });
  it("separates supplier pagination and limits", () => {
    const keys = getSbomKeys("org-a");
    expect(keys.supplierRequestList({ cursor: "a" })).not.toEqual(
      keys.supplierRequestList({ cursor: "b" }),
    );
    expect(keys.supplierRequestList({ limit: 10 })).not.toEqual(
      keys.supplierRequestList({ limit: 25 }),
    );
  });
  it("keeps every read and invalidation key inside the same tenant boundary", () => {
    const keys = getSbomKeys("a");
    const empty = getSbomKeys(null);
    const paths = [
      keys.compositeReview("id"),
      keys.supplierRequestList({}),
      keys.supplierRequestList({
        productId: "p",
        releaseId: "r",
        state: "s",
        cursor: "c",
        limit: 10,
      }),
      keys.job("id"),
      keys.sourceHistory("p", "r", {}),
      keys.sourceHistory("p", "r", { cursor: "c", limit: 10 }),
      keys.validationReport("id"),
      keys.documentsForRelease("p", "r", {}),
      keys.documentsForRelease("p", "r", { cursor: "c", limit: 10 }),
      keys.document("id"),
      keys.componentSearch("id", {}),
      keys.componentSearch("id", { q: "q", cursor: "c", limit: 10 }),
      keys.dependencyTreeChildren("id", {}),
      keys.dependencyTreeChildren("id", {
        parentComponentId: "p",
        q: "q",
        cursor: "c",
        limit: 10,
      }),
      keys.qualityReport("id"),
      keys.qualityFindings("id", {}),
      keys.qualityFindings("id", {
        cursor: "c",
        limit: 10,
        severity: "warning",
        kind: "profile",
      }),
      keys.sourceDiffReport("id", {}),
      keys.sourceDiffReport("id", { baseSourceId: "b" }),
      keys.diffReport("id"),
      keys.diffComponents("id", {}),
      keys.diffComponents("id", {
        cursor: "c",
        limit: 10,
        change: "added",
        ecosystem: "npm",
        q: "q",
      }),
      keys.diffFindings("id", {}),
      keys.diffFindings("id", { cursor: "c", limit: 10 }),
    ];
    for (const key of paths) expect(key.slice(0, 3)).toEqual(keys.all);
    expect(empty.all).toEqual(["sboms", "organization", "none"]);
  });
});
