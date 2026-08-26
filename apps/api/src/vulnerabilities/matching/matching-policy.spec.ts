import { evaluatePurlOsvComponent } from "./matching-policy";

const component = {
  componentId: "11111111-1111-4111-8111-111111111111",
  canonicalPurl: "pkg:npm/%40scope/example@1.9.0?ignored=value#subpath",
  normalizedVersion: "1.9.0",
  ecosystem: "npm",
};

const candidate = {
  affectedRangeId: "22222222-2222-4222-8222-222222222222",
  sourceRecordId: "33333333-3333-4333-8333-333333333333",
  sourceRecordVersionId: "44444444-4444-4444-8444-444444444444",
  vulnerabilityId: "55555555-5555-4555-8555-555555555555",
  canonicalAdvisoryId: "CVE-2026-1",
  sourceFeedKey: "osv" as const,
  ecosystem: "npm",
  purlType: "npm",
  purlNamespace: "@scope",
  purlName: "example",
  rangeType: "SEMVER",
  rangeValue: {},
  eventSequence: [{ introduced: "1.0.0" }, { fixed: "2.0.0" }],
};

describe("evaluatePurlOsvComponent", () => {
  it("matches a canonical PURL against OSV events without a CPE fallback", () => {
    const evaluations = evaluatePurlOsvComponent(component, [candidate]);

    expect(evaluations).toEqual([
      expect.objectContaining({
        componentId: component.componentId,
        outcome: "affected",
        canonicalAdvisoryId: "CVE-2026-1",
        comparatorName: "semver",
        matchMethod: "purl_osv",
      }),
    ]);
  });

  it("treats invalid PURLs, ecosystem conflicts, and unsupported event limits as reviewable", () => {
    expect(
      evaluatePurlOsvComponent(
        { ...component, canonicalPurl: "not-a-purl" },
        [],
      ),
    ).toEqual([
      expect.objectContaining({
        outcome: "reviewable",
        reviewCode: "invalid_purl",
      }),
    ]);
    expect(
      evaluatePurlOsvComponent({ ...component, ecosystem: "maven" }, [
        candidate,
      ]),
    ).toEqual([
      expect.objectContaining({
        outcome: "reviewable",
        reviewCode: "purl_ecosystem_mismatch",
      }),
    ]);
    expect(
      evaluatePurlOsvComponent(component, [
        { ...candidate, eventSequence: [{ limit: "abc" }] },
      ]),
    ).toEqual([
      expect.objectContaining({
        outcome: "reviewable",
        reviewCode: "unsupported_range",
      }),
    ]);
  });

  it("supports explicit versions and keeps a nonaffected candidate as evidence", () => {
    const evaluations = evaluatePurlOsvComponent(component, [
      {
        ...candidate,
        eventSequence: [],
        rangeType: "ECOSYSTEM",
        versions: ["1.8.0"],
      },
    ]);

    expect(evaluations).toEqual([
      expect.objectContaining({
        outcome: "not_affected",
        comparatorName: "semver",
      }),
    ]);
  });

  it("marks an explicit-version affected match as review-visible with a versioned confidence explanation", () => {
    const evaluations = evaluatePurlOsvComponent(component, [
      {
        ...candidate,
        eventSequence: [],
        rangeType: "ECOSYSTEM",
        versions: ["1.9.0"],
      },
    ]);

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({
      outcome: "affected",
      confidence: 0.85,
      confidenceTableVersion: "m4-02.1",
    });
    expect(evaluations[0]?.confidenceExplanation).toContain(
      "explicit affected-version",
    );
  });
});
