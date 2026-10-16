import parseSpdxExpression from "spdx-expression-parse";
import { z } from "zod";
import type { BsiProfileFacts } from "./bsi-profile-facts";
import type { BsiTr03183_2Finding } from "./sbom-quality-policy";

export const BSI_PROFILE_EVALUATOR_VERSION = "bsi-technical.v1" as const;
const MAX_PERSISTED_BSI_FINDINGS = 990;
const MAX_PERSISTED_BSI_FINDING_BYTES = 512 * 1024;
const BOUNDED_SUMMARY_BYTE_RESERVE = 8 * 1024;

export type BsiProfileEvaluation = Readonly<{
  status: "invalid" | "warning";
  findings: readonly BsiTr03183_2Finding[];
  passedRuleCount: number;
  failedRuleCount: number;
  manualReviewRuleCount: number;
}>;

/** Pinned source checks plus explicit human-review obligations. No current-edition or legal verdict. */
export function evaluateBsiProfile(
  facts: BsiProfileFacts,
): BsiProfileEvaluation {
  const findings: BsiTr03183_2Finding[] = [];
  let passedRuleCount = 0;
  let failedRuleCount = 0;
  let manualReviewRuleCount = 0;
  let detailBytes = 2;
  const appendFinding = (
    finding: BsiTr03183_2Finding,
    options: { reserveSummary: boolean },
  ) => {
    const maxFindings = options.reserveSummary
      ? MAX_PERSISTED_BSI_FINDINGS
      : MAX_PERSISTED_BSI_FINDINGS + 1;
    if (findings.length >= maxFindings) return;
    const bytes =
      detailBytes +
      Buffer.byteLength(JSON.stringify(finding)) +
      (findings.length > 0 ? 1 : 0);
    const budget = options.reserveSummary
      ? MAX_PERSISTED_BSI_FINDING_BYTES - BOUNDED_SUMMARY_BYTE_RESERVE
      : MAX_PERSISTED_BSI_FINDING_BYTES;
    if (bytes > budget) return;
    detailBytes = bytes;
    findings.push(Object.freeze(finding));
  };
  const check = (
    clause: string,
    condition: boolean | null,
    path: string,
    expected: string,
    actual: string,
  ) => {
    if (condition === true) {
      passedRuleCount++;
      return;
    }
    if (condition === false) failedRuleCount++;
    else manualReviewRuleCount++;
    appendFinding(
      {
        code: `BSI-2.0.0-${clause}`,
        severity: condition === false ? "error" : "warning",
        sourcePath: path,
        expected,
        actual,
        remediation:
          condition === false
            ? `Correct the source evidence for ${expected}; retain the original and publish a corrected version.`
            : `Human review required: ${expected}. Do not infer acceptance from missing evidence.`,
      },
      { reserveSummary: true },
    );
  };
  check(
    "4-FORMAT",
    facts.serialization !== "tag_value" && minimumVersion(facts),
    "$",
    "Pinned supported format and minimum specification edition",
    `${facts.format} ${facts.specificationVersion} ${facts.serialization}`,
  );
  check(
    "3.1-VULNERABILITIES",
    !facts.embeddedVulnerabilityInformation,
    "$",
    "SBOM source separated from vulnerability statements",
    facts.embeddedVulnerabilityInformation
      ? "Embedded vulnerability information"
      : "No embedded vulnerability information",
  );
  check(
    "5.2.1-CREATOR",
    facts.creatorContacts.some(contact),
    "$.creator",
    "Native SBOM creator contact, distinct from supplier",
    `${facts.creatorContacts.length} native contacts`,
  );
  check(
    "5.2.1-TIMESTAMP",
    dateTime(facts.timestamp),
    "$.timestamp",
    "Compilation timestamp",
    facts.timestamp ?? "Missing",
  );
  check(
    "3.2.1-PRIMARY",
    facts.primaryComponentReference !== null &&
      facts.components.some(
        (component) => component.reference === facts.primaryComponentReference,
      ),
    "$",
    "Primary component represented with component facts",
    facts.primaryComponentReference ?? "Missing",
  );
  const references = new Set(
    facts.components.map((component) => component.reference),
  );
  check(
    "5.1-INSTANCES",
    references.size === facts.components.length,
    "$.components",
    "Distinct component instance references",
    `${references.size} references for ${facts.components.length} instances`,
  );
  for (const component of facts.components) {
    const path = component.sourcePath;
    const required = (
      clause: string,
      field: string,
      condition: boolean | null,
      expected: string,
    ) =>
      check(
        clause,
        !condition &&
          (component.unavailableFields.includes(field) ||
            (component.uncertainFields ?? []).includes(field))
          ? null
          : condition,
        path,
        expected,
        condition
          ? "Source fact present"
          : "Missing, invalid or declared unavailable",
      );
    required(
      "5.2.2-CREATOR",
      "creatorContacts",
      component.creatorContacts.some(contact),
      "Native component creator contact, not supplier contact",
    );
    required(
      "5.2.2-NAME",
      "name",
      present(component.name) || validFilename(component.filename),
      "Component creator name or actual filename fallback",
    );
    required(
      "5.2.2-VERSION",
      "version",
      present(component.version),
      "Creator-assigned version or file creation date fallback",
    );
    required(
      "5.2.2-FILENAME",
      "filename",
      validFilename(component.filename),
      "Actual filename without path",
    );
    required(
      "5.2.2-SHA512",
      "sha512",
      component.sha512.some((value) => /^[a-fA-F0-9]{128}$/.test(value)),
      "Deployable component SHA-512",
    );
    required(
      "5.2.2-DEPENDENCIES",
      "dependencies",
      dependencyCondition(
        component.dependencies,
        references,
        facts.externalBomLinks,
        facts.externalDocumentReferences ?? [],
      ),
      "Explicit direct dependencies including explicit empty leaf",
    );
    required(
      "5.2.2-ASSOCIATED-LICENSES",
      "associatedLicenses",
      component.associatedLicenses.length > 0
        ? licensesCondition(component.associatedLicenses)
        : false,
      "Associated license role and identifiers/expressions",
    );
    required(
      "5.2.2-EXECUTABLE",
      "executable",
      component.executable !== null,
      "Explicit executable classification",
    );
    required(
      "5.2.2-ARCHIVE",
      "archive",
      component.archive !== null,
      "Explicit archive classification",
    );
    required(
      "5.2.2-STRUCTURED",
      "structured",
      component.structured !== null,
      "Explicit structured classification",
    );
    check(
      "5.1-DELIVERY-SCOPE",
      component.inDeliveryScope === null ? null : true,
      path,
      "Recursive delivered inventory through first outside-scope boundary",
      component.inDeliveryScope === null
        ? "Delivery scope not declared"
        : "Declared scope requires build/source corroboration",
    );
    for (const [role, uris] of [
      ["SOURCE-URI", component.sourceCodeUris],
      ["DEPLOYABLE-URI", component.deployableUris],
    ] as const) {
      check(
        `5.3.2-${role}`,
        uris.length > 0 ? uris.every(uri) : null,
        path,
        `Available ${role.toLowerCase()} with independent availability review`,
        uris.length > 0
          ? "Declared URI syntax"
          : "Availability not established",
      );
    }
    check(
      "5.3.2-IDENTIFIERS",
      component.identifiers.length > 0 ? true : null,
      path,
      "Available additional identifiers; PURL is not unconditional",
      component.identifiers.length > 0
        ? "Declared identifiers"
        : "Availability not established",
    );
    check(
      "5.3.2-CONCLUDED-LICENSES",
      component.concludedLicenses.length > 0
        ? licensesCondition(component.concludedLicenses)
        : null,
      path,
      "Available concluded licenses independently from associated licenses",
      component.concludedLicenses.length > 0
        ? "Declared concluded role"
        : "Availability not established",
    );
    check(
      "5.4.1-DECLARED-LICENSES",
      component.declaredLicenses.length > 0
        ? licensesCondition(component.declaredLicenses)
        : true,
      path,
      "Optional declared license syntax without replacing associated role",
      component.declaredLicenses.length > 0
        ? "Declared optional role"
        : "Optional field omitted",
    );
    check(
      "3.2.1-ASSEMBLY-EXCEPTION",
      component.unavailableFields.length > 0 ? null : true,
      path,
      "Corroborate omitted fields against actual assembly constraints",
      component.unavailableFields.join(", ") || "No exception declared",
    );
  }
  check(
    "5.3.1-SBOM-URI",
    facts.documentUri === null ? null : uri(facts.documentUri),
    "$",
    "SBOM URI if available",
    facts.documentUri ?? "Availability not established",
  );
  for (const [clause, expected] of [
    [
      "3.1-VERSION-HISTORY",
      "Verify separate software versions and correction-only SBOM revision history",
    ],
    [
      "3.2.1-BUILD-SEMANTICS",
      "Verify actual linked/interpreted code and creator version/fallback metadata",
    ],
    [
      "5.1-BUILD-INVENTORY",
      "Corroborate complete build inventory and all distinct instances across delivery paths",
    ],
    [
      "6.1-LICENSE-MATCHING",
      "Review SPDX/license database matching, license texts, placeholders, operators and exceptions",
    ],
    [
      "7-CURRENT-EDITION",
      "Review applicable delivery date, current BSI edition and transition window; pinned edition is not current-edition conformity",
    ],
  ])
    check(
      clause!,
      null,
      "$",
      expected!,
      "Not established by source field syntax",
    );
  if (facts.externalBomLinks.length > 0)
    check(
      "5.1-EXTERNAL-BOM",
      null,
      "$",
      "Verify linked BOM availability and full pinned profile before relying on them",
      `${facts.externalBomLinks.length} external links; no network fetch`,
    );
  for (const limitation of facts.limitations)
    check(
      "EXTRACTION-LIMITATION",
      null,
      "$",
      "Resolve source extraction ambiguity",
      limitation.slice(0, 500),
    );
  if (failedRuleCount + manualReviewRuleCount > findings.length) {
    appendFinding(
      {
        code: "BSI-2.0.0-DIAGNOSTICS-BOUNDED",
        severity: "warning",
        sourcePath: "$",
        expected:
          "Bounded persisted diagnostics with complete rule outcome counts",
        actual: `${failedRuleCount + manualReviewRuleCount - findings.length} additional findings omitted from detail`,
        remediation:
          "Use full rule outcome counts and correct source omissions; request a fresh assessment after correction. This bounded detail view is not complete evidence of acceptance.",
      },
      { reserveSummary: false },
    );
  }
  return Object.freeze({
    status: failedRuleCount > 0 ? "invalid" : "warning",
    findings: Object.freeze(findings),
    passedRuleCount,
    failedRuleCount,
    manualReviewRuleCount,
  });
}

function dependencyCondition(
  dependencies: readonly string[] | null,
  references: ReadonlySet<string>,
  externalBomLinks: readonly string[],
  externalDocumentReferences: readonly string[],
): boolean | null {
  if (dependencies === null) return false;
  const missing = dependencies.filter(
    (reference) => !references.has(reference),
  );
  if (missing.length === 0) return true;
  // External references require their exact native declaration; never infer one from a URL.
  return missing.every((reference) => {
    if (/^DocumentRef-[A-Za-z0-9.-]+:SPDXRef-[A-Za-z0-9.-]+$/.test(reference)) {
      return externalDocumentReferences.includes(reference.split(":")[0]!);
    }
    return (
      /^urn:cdx:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-9][0-9]*#.+$/.test(
        reference,
      ) &&
      externalBomLinks.some(
        (link) => link === reference || link === reference.split("#")[0],
      )
    );
  })
    ? null
    : false;
}

function present(value: string | null): boolean {
  return (
    value !== null &&
    value.trim().length > 0 &&
    !["NOASSERTION", "NONE"].includes(value.toUpperCase())
  );
}
function validFilename(value: string | null): boolean {
  return present(value) && !/[\\/]/.test(value!);
}
function uri(value: string): boolean {
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  try {
    return !["javascript:", "data:", "vbscript:"].includes(
      new URL(value).protocol.toLowerCase(),
    );
  } catch {
    return false;
  }
}
function contact(value: string): boolean {
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    (/^https?:\/\//i.test(value) && uri(value))
  );
}
function dateTime(value: string | null): boolean {
  return (
    value !== null &&
    z.string().datetime({ offset: true }).safeParse(value).success
  );
}
function minimumVersion(facts: BsiProfileFacts): boolean {
  // The pinned SPDX 2.2.2 schema uses SPDX-2.2; it meets the 2.2.1 minimum.
  // Normalize only for this minimum comparison, not as source-edition provenance.
  const edition =
    facts.format === "spdx" && facts.specificationVersion === "2.2"
      ? "2.2.1"
      : facts.specificationVersion;
  const version = edition.split(".").map(Number);
  const [major, minor, patch] = version;
  return (
    version.every(Number.isInteger) &&
    (facts.format === "cyclonedx"
      ? major! > 1 || (major === 1 && minor! >= 5)
      : major! > 2 ||
        (major === 2 && (minor! > 2 || (minor === 2 && (patch ?? 0) >= 1))))
  );
}
function licensesCondition(values: readonly string[]): boolean | null {
  const conditions = values.map(licenseExpression);
  return conditions.includes(false)
    ? false
    : conditions.includes(null)
      ? null
      : true;
}
function licenseExpression(value: string): boolean | null {
  if (value.length > 8192) return null;
  // The installed parser intentionally accepts lowercase operators; the pinned syntax does not.
  const operators = (value.match(/[^\s()]+/g) ?? []).filter((token) =>
    /^(?:AND|OR|WITH)$/i.test(token),
  );
  if (operators.some((operator) => operator !== operator.toUpperCase()))
    return false;
  let depth = 0;
  for (const char of value) {
    if (char === "(" && ++depth > 32) return null;
    if (char === ")") depth--;
  }
  if (operators.length > 256) return null;
  if (
    (value.match(/LicenseRef-[A-Za-z0-9.-]+/g) ?? []).some(
      (identifier) =>
        !/^LicenseRef-[A-Za-z0-9.-]+-[A-Za-z0-9.-]+$/.test(identifier),
    )
  )
    return false;
  try {
    parseSpdxExpression(value);
    return true;
  } catch {
    return false;
  }
}
