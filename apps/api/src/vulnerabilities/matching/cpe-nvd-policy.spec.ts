import { evaluateCpeNvdComponent, parseCpeIdentity } from "./cpe-nvd-policy";
import { evaluatePurlOsvComponent } from "./matching-policy";

const component = {
  componentId: "11111111-1111-4111-8111-111111111111",
  canonicalPurl: null,
  canonicalCpe: "cpe:2.3:a:acme:widget:1.5.0:*:*:*:*:*:*:*",
  normalizedVersion: "1.5.0",
  ecosystem: "npm",
};

const candidate = {
  affectedRangeId: "22222222-2222-4222-8222-222222222222",
  sourceRecordId: "CVE-2026-1000",
  sourceRecordVersionId: "33333333-3333-4333-8333-333333333333",
  vulnerabilityId: "44444444-4444-4444-8444-444444444444",
  canonicalAdvisoryId: "CVE-2026-1000",
  sourceFeedKey: "nvd" as const,
  configuration: {
    operator: "OR" as const,
    cpeMatch: [
      {
        criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
        vulnerable: true,
        versionStartIncluding: "1.0.0",
        versionEndExcluding: "2.0.0",
      },
    ],
    nodes: [],
  },
};

describe("CPE/NVD matching policy", () => {
  it("parses conservative CPE 2.3 and URI identities", () => {
    expect(
      parseCpeIdentity("cpe:2.3:a:Acme:Widget:1.5.0:*:*:*:*:*:*:*"),
    ).toMatchObject({
      binding: "2.3",
      part: "a",
      vendor: "acme",
      product: "widget",
    });
    expect(parseCpeIdentity("cpe:/a:acme:widget:1.5.0")).toMatchObject({
      binding: "uri",
      version: "1.5.0",
    });
    expect(parseCpeIdentity("cpe:2.3:a:acme:*:*:*:*:*:*:*:*:*")).toBeNull();
    expect(parseCpeIdentity("cpe:2.3:a:acme:widget")).toBeNull();
  });

  it("uses CPE only after a PURL is absent or invalid and applies CPE bounds", () => {
    expect(
      evaluatePurlOsvComponent(
        { ...component, canonicalPurl: "pkg:npm/widget@1.5.0" },
        [],
      ),
    ).toEqual([]);

    expect(evaluateCpeNvdComponent(component, [candidate])).toEqual([
      expect.objectContaining({
        outcome: "affected",
        matchMethod: "cpe_nvd",
        confidence: 0.7,
        cpeSpecificity: "version_specific",
      }),
    ]);
    expect(
      evaluateCpeNvdComponent({ ...component, canonicalPurl: "not-a-purl" }, [
        candidate,
      ]),
    ).toHaveLength(1);
    expect(
      evaluateCpeNvdComponent({ ...component, canonicalCpe: null }, [
        candidate,
      ]),
    ).toEqual([]);
  });

  it("retains an unambiguous CSAF CPE assertion as vendor evidence", () => {
    const evaluations = evaluateCpeNvdComponent(component, [
      { ...candidate, sourceFeedKey: "vendor_csaf" as const },
    ]);

    expect(evaluations).toEqual([
      expect.objectContaining({
        outcome: "affected",
        sourceFeedKey: "vendor_csaf",
        matchMethod: "cpe_nvd",
      }),
    ]);
  });

  it("evaluates nested AND/OR, negation, vulnerable flags, and broad-family confidence", () => {
    const nested = {
      ...candidate,
      configuration: {
        operator: "AND" as const,
        cpeMatch: [
          {
            criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
            vulnerable: true,
          },
        ],
        nodes: [
          {
            operator: "OR" as const,
            negate: true,
            cpeMatch: [
              {
                criteria: "cpe:2.3:a:acme:widget:2.0.0:*:*:*:*:*:*:*",
                vulnerable: false,
              },
            ],
            nodes: [],
          },
        ],
      },
    };

    expect(evaluateCpeNvdComponent(component, [nested])).toEqual([
      expect.objectContaining({
        outcome: "affected",
        confidence: 0.55,
        cpeSpecificity: "broad_family",
      }),
    ]);
  });

  it("keeps malformed criteria and unresolved platform constraints reviewable", () => {
    expect(
      evaluateCpeNvdComponent(component, [
        {
          ...candidate,
          configuration: {
            operator: "OR",
            cpeMatch: [{ criteria: "not-a-cpe", vulnerable: true }],
            nodes: [],
          },
        },
      ]),
    ).toEqual([expect.objectContaining({ reviewCode: "invalid_cpe" })]);

    expect(
      evaluateCpeNvdComponent(component, [
        {
          ...candidate,
          configuration: {
            operator: "AND",
            cpeMatch: [
              {
                criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
                vulnerable: true,
              },
              {
                criteria: "cpe:2.3:o:acme:os:*:*:*:*:*:*:*:*",
                vulnerable: false,
              },
            ],
            nodes: [],
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({ reviewCode: "platform_constraint_unresolved" }),
    ]);
  });

  it("does not let a non-vulnerable platform branch make an OR tree reviewable", () => {
    expect(
      evaluateCpeNvdComponent(component, [
        {
          ...candidate,
          configuration: {
            operator: "OR",
            cpeMatch: [
              {
                criteria: "cpe:2.3:a:other:other:*:*:*:*:*:*:*:*",
                vulnerable: true,
              },
              {
                criteria: "cpe:2.3:o:acme:os:*:*:*:*:*:*:*:*",
                vulnerable: false,
              },
            ],
            nodes: [],
          },
        },
      ]),
    ).toEqual([expect.objectContaining({ outcome: "not_affected" })]);
  });

  it("honours inclusive and exclusive CPE version boundaries and vulnerable=false", () => {
    const bounded = {
      ...candidate,
      configuration: {
        operator: "OR" as const,
        cpeMatch: [
          {
            criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
            vulnerable: true,
            versionStartExcluding: "1.5.0",
            versionEndIncluding: "1.5.0",
          },
        ],
        nodes: [],
      },
    };
    expect(evaluateCpeNvdComponent(component, [bounded])).toEqual([
      expect.objectContaining({ outcome: "not_affected" }),
    ]);
    expect(
      evaluateCpeNvdComponent(component, [
        {
          ...bounded,
          configuration: {
            ...bounded.configuration,
            cpeMatch: [
              {
                ...bounded.configuration.cpeMatch[0]!,
                versionStartExcluding: undefined,
                versionStartIncluding: "1.5.0",
              },
            ],
          },
        },
      ]),
    ).toEqual([expect.objectContaining({ outcome: "affected" })]);

    expect(
      evaluateCpeNvdComponent(component, [
        {
          ...candidate,
          configuration: {
            operator: "OR",
            cpeMatch: [
              {
                criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
                vulnerable: false,
              },
            ],
            nodes: [],
          },
        },
      ]),
    ).toEqual([expect.objectContaining({ outcome: "not_affected" })]);
  });
});
