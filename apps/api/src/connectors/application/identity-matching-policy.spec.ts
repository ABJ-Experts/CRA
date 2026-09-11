import {
  matchExternalProductRecord,
  matchExternalReleaseRecord,
  normalizeIdentity,
} from "./identity-matching-policy";

describe("normalizeIdentity", () => {
  it("matches the DB generated column: NFKC-normalize, strip whitespace, lowercase", () => {
    expect(normalizeIdentity("GW-100")).toBe("gw-100");
    expect(normalizeIdentity("  GW 100  ")).toBe("gw100");
    expect(normalizeIdentity("gw\t100\n")).toBe("gw100");
    // U+FF21 fullwidth "A" NFKC-normalizes to ASCII "A".
    expect(normalizeIdentity("ＡB")).toBe("ab");
  });
});

describe("matchExternalProductRecord", () => {
  it("matches on an existing active mapping without consulting candidates", () => {
    expect(
      matchExternalProductRecord({
        externalId: "EXT-1",
        existingActiveMapping: { id: "mapping-1" },
        internalCode: null,
        candidateProductsByNormalizedCode: [],
      }),
    ).toEqual({
      outcome: "matched",
      mappingId: "mapping-1",
      matchConfidence: "certain",
    });
  });

  it("matches by normalized code when exactly one unclaimed candidate exists", () => {
    expect(
      matchExternalProductRecord({
        externalId: "EXT-1",
        existingActiveMapping: null,
        internalCode: "GW-100",
        candidateProductsByNormalizedCode: [
          { productId: "product-1", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({
      outcome: "matched",
      mappingId: "product-1",
      matchConfidence: "certain",
    });
  });

  it("is ambiguous when the single candidate already carries a different active mapping", () => {
    expect(
      matchExternalProductRecord({
        externalId: "EXT-1",
        existingActiveMapping: null,
        internalCode: "GW-100",
        candidateProductsByNormalizedCode: [
          { productId: "product-1", hasOtherActiveMapping: true },
        ],
      }),
    ).toEqual({ outcome: "ambiguous", candidateMappingIds: ["product-1"] });
  });

  it("is ambiguous when more than one candidate shares the normalized code", () => {
    expect(
      matchExternalProductRecord({
        externalId: "EXT-1",
        existingActiveMapping: null,
        internalCode: "GW-100",
        candidateProductsByNormalizedCode: [
          { productId: "product-1", hasOtherActiveMapping: false },
          { productId: "product-2", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({
      outcome: "ambiguous",
      candidateMappingIds: ["product-1", "product-2"],
    });
  });

  it("has no match when there is no internal code or no candidates", () => {
    expect(
      matchExternalProductRecord({
        externalId: "EXT-1",
        existingActiveMapping: null,
        internalCode: null,
        candidateProductsByNormalizedCode: [
          { productId: "product-1", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({ outcome: "no_match" });
    expect(
      matchExternalProductRecord({
        externalId: "EXT-1",
        existingActiveMapping: null,
        internalCode: "GW-999",
        candidateProductsByNormalizedCode: [],
      }),
    ).toEqual({ outcome: "no_match" });
  });
});

describe("matchExternalReleaseRecord", () => {
  it("matches on an existing active mapping without resolving the parent", () => {
    expect(
      matchExternalReleaseRecord({
        externalId: "EXT-REL-1",
        existingActiveMapping: { id: "mapping-1" },
        releaseVersion: null,
        parentActiveProductMappingIds: [],
        candidateReleasesByNormalizedVersion: [],
      }),
    ).toEqual({
      outcome: "matched",
      mappingId: "mapping-1",
      matchConfidence: "certain",
    });
  });

  it("is ambiguous when the parent externalId resolves to zero active product mappings", () => {
    expect(
      matchExternalReleaseRecord({
        externalId: "EXT-REL-1",
        existingActiveMapping: null,
        releaseVersion: "1.0.0",
        parentActiveProductMappingIds: [],
        candidateReleasesByNormalizedVersion: [
          { releaseId: "release-1", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({ outcome: "ambiguous", candidateMappingIds: [] });
  });

  it("is ambiguous when the parent externalId resolves to more than one active product mapping", () => {
    expect(
      matchExternalReleaseRecord({
        externalId: "EXT-REL-1",
        existingActiveMapping: null,
        releaseVersion: "1.0.0",
        parentActiveProductMappingIds: [
          "product-mapping-1",
          "product-mapping-2",
        ],
        candidateReleasesByNormalizedVersion: [
          { releaseId: "release-1", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({
      outcome: "ambiguous",
      candidateMappingIds: ["product-mapping-1", "product-mapping-2"],
    });
  });

  it("matches by normalized version once the parent resolves uniquely", () => {
    expect(
      matchExternalReleaseRecord({
        externalId: "EXT-REL-1",
        existingActiveMapping: null,
        releaseVersion: "1.0.0",
        parentActiveProductMappingIds: ["product-mapping-1"],
        candidateReleasesByNormalizedVersion: [
          { releaseId: "release-1", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({
      outcome: "matched",
      mappingId: "release-1",
      matchConfidence: "certain",
    });
  });

  it("has no match when the parent resolves uniquely but the release version is unknown", () => {
    expect(
      matchExternalReleaseRecord({
        externalId: "EXT-REL-1",
        existingActiveMapping: null,
        releaseVersion: null,
        parentActiveProductMappingIds: ["product-mapping-1"],
        candidateReleasesByNormalizedVersion: [
          { releaseId: "release-1", hasOtherActiveMapping: false },
        ],
      }),
    ).toEqual({ outcome: "no_match" });
  });
});
