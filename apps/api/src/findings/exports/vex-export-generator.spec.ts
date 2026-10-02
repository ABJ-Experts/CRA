import { createHash } from "node:crypto";

import {
  VexExportMappingError,
  generateVexExport,
  type VexAssessmentExportRecord,
  type GenerateVexExportInput,
} from "./vex-export-generator";

const firstAssessment = (): VexAssessmentExportRecord => ({
  findingId: "44444444-4444-4444-8444-444444444444",
  assessmentId: "55555555-5555-4555-8555-555555555555",
  revision: 2,
  advisoryId: "CVE-2026-0002",
  canonicalPurl: "pkg:npm/example@1.2.3",
  componentVersion: "1.2.3",
  status: "not_affected",
  justification: "vulnerable_code_not_in_execute_path",
  approvalState: "approved",
  effectiveAt: "2026-09-07T10:00:00.000Z",
  provenanceReference: "assessment:55555555-5555-4555-8555-555555555555:2",
  detail: "This must never be published.",
  evidenceLinks: ["https://internal.example/evidence/secret"],
});

const secondAssessment = (): VexAssessmentExportRecord => ({
  findingId: "66666666-6666-4666-8666-666666666666",
  assessmentId: "77777777-7777-4777-8777-777777777777",
  revision: 1,
  advisoryId: "CVE-2026-0001",
  canonicalPurl: "pkg:npm/other@2.0.0",
  componentVersion: "2.0.0",
  status: "fixed",
  justification: null,
  approvalState: "approval_not_required",
  effectiveAt: "2026-09-07T11:00:00.000Z",
  provenanceReference: "assessment:77777777-7777-4777-8777-777777777777:1",
});

const exportInput = (overrides: Partial<GenerateVexExportInput> = {}) =>
  ({
    format: "openvex",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    generatedAt: "2026-09-08T12:00:00.000Z",
    product: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Sentinel appliance",
    },
    release: {
      id: "33333333-3333-4333-8333-333333333333",
      label: "2026.9",
    },
    assessments: [firstAssessment(), secondAssessment()],
    ...overrides,
  }) satisfies GenerateVexExportInput;

describe("generateVexExport", () => {
  it("creates a deterministic, validated and redacted OpenVEX 0.2.0 document", () => {
    const first = generateVexExport(exportInput());
    const second = generateVexExport(
      exportInput({ assessments: [...exportInput().assessments].reverse() }),
    );

    expect(first).toEqual(second);
    expect(first.format).toBe("openvex");
    expect(first.specificationVersion).toBe("0.2.0");
    expect(first.mediaType).toBe("application/vnd.openvex+json");
    expect(first.validation.valid).toBe(true);
    expect(first.validation.schemaSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sha256).toBe(
      createHash("sha256").update(first.bytes).digest("hex"),
    );
    expect(first.sha256).toBe(
      "4028a7564870cdaccf989d528f016ac9313f740cafc099ee85146fd7fa1ce89c",
    );
    expect(first.bytes.toString("utf8")).not.toContain("This must never");
    expect(first.bytes.toString("utf8")).not.toContain("internal.example");
    expect(first.document).toMatchObject({
      "@context": "https://openvex.dev/ns/v0.2.0",
      version: 1,
      statements: [
        {
          vulnerability: { name: "CVE-2026-0001" },
          status: "fixed",
        },
        {
          vulnerability: { name: "CVE-2026-0002" },
          status: "not_affected",
          justification: "vulnerable_code_not_in_execute_path",
        },
      ],
    });
  });

  it("creates a CycloneDX 1.6 VEX with only exact status and justification mappings", () => {
    const exported = generateVexExport(
      exportInput({ format: "cyclonedx-vex" }),
    );

    expect(exported).toMatchObject({
      format: "cyclonedx-vex",
      specificationVersion: "1.6",
      mediaType: "application/vnd.cyclonedx+json",
      validation: { valid: true },
      document: {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        vulnerabilities: [
          {
            id: "CVE-2026-0001",
            analysis: { state: "resolved" },
          },
          {
            id: "CVE-2026-0002",
            analysis: {
              state: "not_affected",
              justification: "code_not_reachable",
            },
          },
        ],
      },
    });
  });

  it("maps an affected assessment directly in OpenVEX without exposing private notes", () => {
    const exported = generateVexExport(
      exportInput({
        assessments: [
          {
            ...firstAssessment(),
            status: "affected",
            justification: null,
          },
        ],
      }),
    );

    expect(exported.document).toMatchObject({
      statements: [
        {
          status: "affected",
          action_statement: "Remediation is tracked by the product owner.",
        },
      ],
    });
    expect(exported.bytes.toString("utf8")).not.toContain("This must never");
  });

  it.each([
    ["affected", null],
    ["not_affected", "vulnerable_code_cannot_be_controlled_by_adversary"],
    ["not_affected", "inline_mitigations_already_exist"],
  ] as const)(
    "rejects lossy CycloneDX mapping for %s",
    (status, justification) => {
      expect(() =>
        generateVexExport(
          exportInput({
            format: "cyclonedx-vex",
            assessments: [
              {
                ...firstAssessment(),
                status,
                justification,
              },
            ],
          }),
        ),
      ).toThrow(VexExportMappingError);
    },
  );

  it("rejects invalid data instead of emitting a specification-shaped lie", () => {
    expect(() =>
      generateVexExport(
        exportInput({
          assessments: [
            {
              ...firstAssessment(),
              canonicalPurl: null,
            },
          ],
        }),
      ),
    ).toThrow(/stable component identifier/i);
  });

  it("does not generate an empty VEX document", () => {
    expect(() => generateVexExport(exportInput({ assessments: [] }))).toThrow(
      /eligible assessment/i,
    );
  });
});
