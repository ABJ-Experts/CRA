import { evaluateBsiProfile } from "./bsi-profile-evaluator";
import type { BsiProfileFacts } from "./bsi-profile-facts";

export function completeFacts(): BsiProfileFacts {
  return {
    format: "cyclonedx",
    specificationVersion: "1.6",
    serialization: "json",
    creatorContacts: ["author@example.test"],
    timestamp: "2026-09-28T00:00:00Z",
    documentUri: "https://example.test/bom",
    primaryComponentReference: "root",
    embeddedVulnerabilityInformation: false,
    externalBomLinks: [],
    limitations: [],
    components: [
      {
        reference: "root",
        sourcePath: "$.metadata.component",
        creatorContacts: ["https://example.test"],
        name: "Example",
        version: "1.0",
        filename: "example.bin",
        sha512: ["a".repeat(128)],
        dependencies: [],
        associatedLicenses: ["MIT"],
        concludedLicenses: [],
        declaredLicenses: [],
        executable: true,
        archive: false,
        structured: false,
        sourceCodeUris: [],
        deployableUris: [],
        identifiers: [],
        inDeliveryScope: true,
        unavailableFields: [],
      },
    ],
  };
}

describe("pinned BSI technical evaluation", () => {
  it("uses the permitted actual filename fallback and reviews declared assembly creator omissions", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      components: [
        {
          ...facts.components[0]!,
          name: null,
          creatorContacts: [],
          unavailableFields: ["creatorContacts"],
        },
      ],
    });
    expect(result.failedRuleCount).toBe(0);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "BSI-2.0.0-5.2.2-CREATOR",
        severity: "warning",
      }),
    );
  });
  it("bounds detailed findings by bytes while retaining complete outcome counts", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      components: Array.from({ length: 1000 }, (_, index) => ({
        ...facts.components[0]!,
        reference: `component-${index}`,
        sourcePath: `$.${"nested.".repeat(130)}components[${index}]`,
        creatorContacts: [],
        version: null,
        filename: null,
        sha512: [],
      })),
    });
    expect(Buffer.byteLength(JSON.stringify(result.findings))).toBeLessThan(
      600 * 1024,
    );
    expect(result.failedRuleCount).toBeGreaterThan(result.findings.length);
    expect(result.findings.at(-1)?.code).toBe("BSI-2.0.0-DIAGNOSTICS-BOUNDED");
  });
  it("preserves bounded exact locations beyond 500 characters", () => {
    const facts = completeFacts();
    const paths = ["0", "1"].map(
      (index) => `$.${"nested.".repeat(80)}components[${index}]`,
    );
    const result = evaluateBsiProfile({
      ...facts,
      components: paths.map((sourcePath, index) => ({
        ...facts.components[0]!,
        reference: `component-${index}`,
        sourcePath,
        creatorContacts: [],
      })),
    });
    const findings = result.findings.filter(
      (finding) => finding.code === "BSI-2.0.0-5.2.2-CREATOR",
    );
    expect(findings.map((finding) => finding.sourcePath)).toEqual(paths);
  });
  it("accepts an explicit leaf without requiring PURL and retains manual truth/edition checks", () => {
    const result = evaluateBsiProfile(completeFacts());
    expect(result.status).toBe("warning");
    expect(result.failedRuleCount).toBe(0);
    expect(result.manualReviewRuleCount).toBeGreaterThan(0);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "BSI-2.0.0-3.1-VERSION-HISTORY",
        "BSI-2.0.0-5.1-BUILD-INVENTORY",
        "BSI-2.0.0-7-CURRENT-EDITION",
      ]),
    );
  });

  it.each([
    { format: "spdx" as const, specificationVersion: "2.2.1", valid: true },
    { format: "spdx" as const, specificationVersion: "2.2", valid: true },
    { format: "spdx" as const, specificationVersion: "2.3", valid: true },
    { format: "spdx" as const, specificationVersion: "3.0", valid: true },
    { format: "cyclonedx" as const, specificationVersion: "2.0", valid: true },
    {
      format: "cyclonedx" as const,
      specificationVersion: "not-version",
      valid: false,
    },
  ])(
    "uses exact specification minimums, not format names: %j",
    ({ format, specificationVersion, valid }) => {
      expect(
        evaluateBsiProfile({ ...completeFacts(), format, specificationVersion })
          .failedRuleCount === 0,
      ).toBe(valid);
    },
  );

  it("checks present conditional/optional facts without conflating license roles", () => {
    const facts = completeFacts();
    const complete = {
      ...facts.components[0]!,
      sourceCodeUris: ["https://example.test/source"],
      deployableUris: ["urn:example:binary"],
      identifiers: ["pkg:npm/example@1"],
      concludedLicenses: ["MIT"],
      declaredLicenses: ["Apache-2.0"],
    };
    expect(
      evaluateBsiProfile({ ...facts, components: [complete] }).failedRuleCount,
    ).toBe(0);
    const invalid = evaluateBsiProfile({
      ...facts,
      documentUri: "not-uri",
      limitations: ["unknown representation"],
      components: [
        {
          ...complete,
          sourceCodeUris: ["not-uri"],
          concludedLicenses: ["broken AND"],
          declaredLicenses: ["NONE"],
          inDeliveryScope: null,
        },
      ],
    });
    expect(invalid.failedRuleCount).toBe(4);
    expect(invalid.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BSI-2.0.0-EXTRACTION-LIMITATION",
          severity: "warning",
        }),
      ]),
    );
  });

  it("retains complete rule counts while bounding persisted finding details", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      documentUri: null,
      components: Array.from({ length: 200 }, (_, i) => ({
        ...facts.components[0]!,
        reference: i === 0 ? "root" : `c${i}`,
        name: null,
        creatorContacts: [],
        inDeliveryScope: null,
        sha512: [],
      })),
    });
    expect(result.findings.length).toBeLessThanOrEqual(991);
    expect(
      result.failedRuleCount + result.manualReviewRuleCount,
    ).toBeGreaterThan(result.findings.length);
    expect(result.findings.at(-1)?.code).toBe("BSI-2.0.0-DIAGNOSTICS-BOUNDED");
  });

  it.each([
    "MIT".repeat(3000),
    Array.from({ length: 258 }, () => "MIT").join(" AND "),
  ])("retains resource-cap ambiguity: %s", (license) => {
    const facts = completeFacts();
    expect(
      evaluateBsiProfile({
        ...facts,
        components: [
          { ...facts.components[0]!, associatedLicenses: [license] },
        ],
      }).failedRuleCount,
    ).toBe(0);
  });

  it.each([
    { specificationVersion: "1.4" },
    { serialization: "tag_value" as const },
    { embeddedVulnerabilityInformation: true },
    { creatorContacts: ["supplier-name"] },
    { creatorContacts: ["urn:vendor:creator"] },
    { timestamp: "not-a-date" },
    { timestamp: "2024-02-30T00:00:00Z" },
    { primaryComponentReference: null },
  ])("rejects machine-verifiable document omissions: %j", (change) => {
    expect(evaluateBsiProfile({ ...completeFacts(), ...change }).status).toBe(
      "invalid",
    );
  });

  it.each([
    { creatorContacts: [] },
    { name: null, filename: null },
    { version: null },
    { filename: "dir/a.bin" },
    { sha512: ["a".repeat(64)] },
    { dependencies: null },
    { dependencies: ["missing"] },
    { associatedLicenses: ["UnknownLicense"] },
    { executable: null },
    { archive: null },
    { structured: null },
  ])(
    "rejects required component facts without treating supplier as creator: %j",
    (change) => {
      const facts = completeFacts();
      expect(
        evaluateBsiProfile({
          ...facts,
          components: [{ ...facts.components[0]!, ...change }],
        }).status,
      ).toBe("invalid");
    },
  );

  it("accepts an actual filename as the component name fallback", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      components: [{ ...facts.components[0]!, name: null, filename: "a.bin" }],
    });
    expect(
      result.findings.some(
        (finding) => finding.code === "BSI-2.0.0-5.2.2-NAME",
      ),
    ).toBe(false);
  });

  it("keeps unstructured unavailable evidence for review instead of silently accepting or rejecting", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      components: [
        {
          ...facts.components[0]!,
          filename: null,
          sha512: [],
          unavailableFields: ["filename", "sha512"],
        },
      ],
    });
    expect(result.failedRuleCount).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BSI-2.0.0-5.2.2-FILENAME",
          severity: "warning",
        }),
      ]),
    );
  });

  it("distinguishes ambiguous license roles from missing required source fields", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      components: [
        {
          ...facts.components[0]!,
          associatedLicenses: [],
          uncertainFields: ["associatedLicenses"],
        },
      ],
    });
    expect(result.failedRuleCount).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BSI-2.0.0-5.2.2-ASSOCIATED-LICENSES",
          severity: "warning",
        }),
      ]),
    );
  });

  it("keeps only explicitly declared and scoped BOM-link dependencies unknown", () => {
    const facts = completeFacts();
    const link = "urn:cdx:11111111-1111-4111-8111-111111111111/1";
    const linked = {
      ...facts,
      externalBomLinks: [link],
      components: [
        { ...facts.components[0]!, dependencies: [`${link}#component`] },
      ],
    };
    expect(evaluateBsiProfile(linked).failedRuleCount).toBe(0);
    expect(evaluateBsiProfile(linked).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BSI-2.0.0-5.2.2-DEPENDENCIES",
          severity: "warning",
        }),
      ]),
    );
    expect(
      evaluateBsiProfile({
        ...linked,
        components: [{ ...linked.components[0]!, dependencies: ["missing"] }],
      }).failedRuleCount,
    ).toBe(1);
    expect(
      evaluateBsiProfile({
        ...linked,
        externalBomLinks: [link.replace("/1", "/2")],
      }).failedRuleCount,
    ).toBe(1);
    expect(
      evaluateBsiProfile({
        ...linked,
        externalBomLinks: ["https://example.test/bom"],
        components: [
          {
            ...linked.components[0]!,
            dependencies: ["https://example.test/bom#component"],
          },
        ],
      }).failedRuleCount,
    ).toBe(1);
  });

  it("preserves only exact declared SPDX external document bindings for review", () => {
    const facts = completeFacts();
    const linked = {
      ...facts,
      format: "spdx" as const,
      specificationVersion: "2.3",
      externalBomLinks: ["https://example.test/supplier"],
      externalDocumentReferences: ["DocumentRef-supplier"],
      components: [
        {
          ...facts.components[0]!,
          dependencies: ["DocumentRef-supplier:SPDXRef-a"],
        },
      ],
    };
    expect(evaluateBsiProfile(linked).failedRuleCount).toBe(0);
    expect(
      evaluateBsiProfile({
        ...linked,
        externalDocumentReferences: ["DocumentRef-other"],
      }).failedRuleCount,
    ).toBe(1);
    expect(
      evaluateBsiProfile({
        ...linked,
        components: [
          {
            ...linked.components[0]!,
            dependencies: ["DocumentRef-supplier:bad"],
          },
        ],
      }).failedRuleCount,
    ).toBe(1);
  });

  it("checks absolute URI syntax separately from creator URL and unsafe schemes", () => {
    const facts = completeFacts();
    const uris = {
      ...facts.components[0]!,
      sourceCodeUris: [
        "git+https://example.test/source",
        "ftp://example.test/source",
      ],
      deployableUris: ["pkg:npm/example@1"],
    };
    expect(
      evaluateBsiProfile({
        ...facts,
        creatorContacts: ["HTTPS://example.test"],
        components: [uris],
      }).failedRuleCount,
    ).toBe(0);
    expect(
      evaluateBsiProfile({
        ...facts,
        components: [{ ...uris, deployableUris: ["javascript:alert(1)"] }],
      }).failedRuleCount,
    ).toBe(1);
  });

  it("does not fetch external links or certify their profile or availability", () => {
    const result = evaluateBsiProfile({
      ...completeFacts(),
      externalBomLinks: ["https://example.test/bom"],
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BSI-2.0.0-5.1-EXTERNAL-BOM",
          severity: "warning",
        }),
      ]),
    );
  });

  it.each([
    "GPL-2.0-only WITH Classpath-exception-2.0",
    "MIT AND Apache-2.0",
    "(MIT OR Apache-2.0)",
    "LicenseRef-scancode-example",
    "LicenseRef-org-example",
    "LicenseRef-org-and-license",
    "LicenseRef-org-with-library",
    "LicenseRef-org-or-library",
    "LicenseRef-org-and-license AND MIT",
  ])(
    "parses identifier/operator structure while leaving license matching to review: %s",
    (license) => {
      const facts = completeFacts();
      expect(
        evaluateBsiProfile({
          ...facts,
          components: [
            { ...facts.components[0]!, associatedLicenses: [license] },
          ],
        }).failedRuleCount,
      ).toBe(0);
    },
  );

  it("reports resource-capped expressions as manual unknown, never as invalid syntax", () => {
    const facts = completeFacts();
    const result = evaluateBsiProfile({
      ...facts,
      components: [
        {
          ...facts.components[0]!,
          associatedLicenses: ["(".repeat(33) + "MIT" + ")".repeat(33)],
        },
      ],
    });
    expect(result.failedRuleCount).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BSI-2.0.0-5.2.2-ASSOCIATED-LICENSES",
          severity: "warning",
        }),
      ]),
    );
  });

  it.each([
    "MIT or Apache-2.0",
    "LicenseRef-org-and-license and MIT",
    "LicenseRef-org-with-library with Classpath-exception-2.0",
    "GPL-2.0-only WITH Imaginary-exception",
    "MIT OR",
    "MIT Apache-2.0",
    "(MIT",
    "MIT AND (Apache-2.0 OR)",
    "LicenseRef-example",
    "<script>",
  ])("rejects malformed or nonnamespaced expressions: %s", (license) => {
    const facts = completeFacts();
    expect(
      evaluateBsiProfile({
        ...facts,
        components: [
          { ...facts.components[0]!, associatedLicenses: [license] },
        ],
      }).status,
    ).toBe("invalid");
  });
});
