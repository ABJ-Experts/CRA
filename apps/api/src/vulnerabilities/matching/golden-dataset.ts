import { createHash } from "node:crypto";

import {
  evaluateCpeNvdComponent,
  type NvdCpeCandidate,
} from "./cpe-nvd-policy";
import { evaluatePurlOsvComponent, type OsvCandidate } from "./matching-policy";

/** Reviewed PURL and CPE coverage, including deliberately negative examples. */
export const GOLDEN_DATASET_VERSION = "1.2.0";
export const GOLDEN_DATASET_SHA256 =
  "572497c00060b5a6f000c2cc98597a33dd4e2a72e834f2012480b4020af908b5";

const candidate = (overrides: Partial<OsvCandidate> = {}): OsvCandidate => ({
  affectedRangeId: "22222222-2222-4222-8222-222222222222",
  sourceRecordId: "33333333-3333-4333-8333-333333333333",
  sourceRecordVersionId: "44444444-4444-4444-8444-444444444444",
  vulnerabilityId: "55555555-5555-4555-8555-555555555555",
  canonicalAdvisoryId: "CVE-2026-1",
  sourceFeedKey: "osv",
  ecosystem: "npm",
  purlType: "npm",
  purlNamespace: null,
  purlName: "example",
  rangeType: "SEMVER",
  rangeValue: {},
  eventSequence: [{ introduced: "1.0.0" }, { fixed: "2.0.0" }],
  ...overrides,
});

const cpeCandidate = (
  overrides: Partial<NvdCpeCandidate> = {},
): NvdCpeCandidate => ({
  affectedRangeId: "22222222-2222-4222-8222-222222222222",
  sourceRecordId: "33333333-3333-4333-8333-333333333333",
  sourceRecordVersionId: "44444444-4444-4444-8444-444444444444",
  vulnerabilityId: "55555555-5555-4555-8555-555555555555",
  canonicalAdvisoryId: "CVE-2026-CPE-1",
  sourceFeedKey: "nvd",
  configuration: {
    operator: "OR",
    cpeMatch: [
      {
        criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
        vulnerable: true,
      },
    ],
    nodes: [],
  },
  configurationPath: "0/match/0",
  ...overrides,
});

export const GOLDEN_DATASET = Object.freeze([
  {
    release: "golden-npm",
    ecosystem: "npm",
    component: {
      componentId: "11111111-1111-4111-8111-111111111111",
      canonicalPurl: "pkg:npm/example@1.9.0",
      normalizedVersion: "1.9.0",
      ecosystem: "npm",
    },
    candidates: [candidate()],
    expectedAffected: ["CVE-2026-1"],
  },
  {
    release: "golden-npm-fixed",
    ecosystem: "npm",
    component: {
      componentId: "66666666-6666-4666-8666-666666666666",
      canonicalPurl: "pkg:npm/example@2.0.0",
      normalizedVersion: "2.0.0",
      ecosystem: "npm",
    },
    candidates: [candidate()],
    expectedAffected: [],
  },
  {
    release: "golden-pypi",
    ecosystem: "pypi",
    component: {
      componentId: "77777777-7777-4777-8777-777777777777",
      canonicalPurl: "pkg:pypi/example@1.0rc1",
      normalizedVersion: "1.0rc1",
      ecosystem: "pypi",
    },
    candidates: [
      candidate({
        ecosystem: "pypi",
        purlType: "pypi",
        rangeType: "ECOSYSTEM",
        eventSequence: [{ introduced: "0" }, { fixed: "1.0" }],
      }),
    ],
    expectedAffected: ["CVE-2026-1"],
  },
  {
    release: "golden-debian-epoch-tilde",
    ecosystem: "deb",
    component: {
      componentId: "88888888-8888-4888-8888-888888888888",
      canonicalPurl: "pkg:deb/debian/example@1:1.0~rc1-1",
      normalizedVersion: "1:1.0~rc1-1",
      ecosystem: "deb",
    },
    candidates: [
      candidate({
        ecosystem: "deb",
        purlType: "deb",
        purlNamespace: "debian",
        rangeType: "ECOSYSTEM",
        eventSequence: [{ introduced: "1:1.0~rc1-1" }, { fixed: "1:1.0-1" }],
      }),
    ],
    expectedAffected: ["CVE-2026-1"],
  },
  {
    release: "golden-rpm-release",
    ecosystem: "rpm",
    component: {
      componentId: "99999999-9999-4999-8999-999999999999",
      canonicalPurl: "pkg:rpm/fedora/example@1.9-1",
      normalizedVersion: "1.9-1",
      ecosystem: "rpm",
    },
    candidates: [
      candidate({
        ecosystem: "rpm",
        purlType: "rpm",
        purlNamespace: "fedora",
        rangeType: "ECOSYSTEM",
        eventSequence: [{ introduced: "0" }, { fixed: "1.10-1" }],
      }),
    ],
    expectedAffected: ["CVE-2026-1"],
  },
  {
    release: "golden-maven-equivalence",
    ecosystem: "maven",
    component: {
      componentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      canonicalPurl: "pkg:maven/org.example/example@1.0.0",
      normalizedVersion: "1.0.0",
      ecosystem: "maven",
    },
    candidates: [
      candidate({
        ecosystem: "maven",
        purlType: "maven",
        purlNamespace: "org.example",
        rangeType: "ECOSYSTEM",
        eventSequence: [{ introduced: "0" }, { lastAffected: "1.0" }],
      }),
    ],
    expectedAffected: ["CVE-2026-1"],
  },
  {
    release: "golden-go-incompatible",
    ecosystem: "golang",
    component: {
      componentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      canonicalPurl: "pkg:golang/example.com/example@v1.9.0%2Bincompatible",
      normalizedVersion: "v1.9.0+incompatible",
      ecosystem: "golang",
    },
    candidates: [
      candidate({
        ecosystem: "golang",
        purlType: "golang",
        purlNamespace: "example.com",
        rangeType: "ECOSYSTEM",
        eventSequence: [{ introduced: "0" }, { fixed: "v1.10.0" }],
      }),
    ],
    expectedAffected: ["CVE-2026-1"],
  },
  {
    release: "golden-explicit-version",
    ecosystem: "npm",
    component: {
      componentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      canonicalPurl:
        "pkg:npm/exact@1.2.3?repository_url=https%3A%2F%2Fregistry.example",
      normalizedVersion: "1.2.3",
      ecosystem: "npm",
    },
    candidates: [
      candidate({
        purlName: "exact",
        rangeType: "ECOSYSTEM",
        eventSequence: [],
        versions: ["1.2.3"],
      }),
    ],
    expectedAffected: ["CVE-2026-1"],
  },
] as const);

export const CPE_GOLDEN_DATASET = Object.freeze([
  {
    release: "golden-cpe-version-specific",
    ecosystem: "npm",
    component: {
      componentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      canonicalPurl: null,
      canonicalCpe: "cpe:2.3:a:acme:widget:1.5.0:*:*:*:*:*:*:*",
      normalizedVersion: "1.5.0",
      ecosystem: "npm",
    },
    candidates: [
      cpeCandidate({
        configuration: {
          operator: "OR",
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
      }),
    ],
    expectedAffected: ["CVE-2026-CPE-1"],
  },
  {
    release: "golden-cpe-broad-family",
    ecosystem: "npm",
    component: {
      componentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      canonicalPurl: null,
      canonicalCpe: "cpe:/a:acme:widget",
      normalizedVersion: "1.5.0",
      ecosystem: "npm",
    },
    candidates: [cpeCandidate()],
    expectedAffected: ["CVE-2026-CPE-1"],
  },
  {
    release: "golden-cpe-nested-negative",
    ecosystem: "npm",
    component: {
      componentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      canonicalPurl: null,
      canonicalCpe: "cpe:2.3:a:acme:widget:3.0.0:*:*:*:*:*:*:*",
      normalizedVersion: "3.0.0",
      ecosystem: "npm",
    },
    candidates: [
      cpeCandidate({
        configuration: {
          operator: "AND",
          cpeMatch: [],
          nodes: [
            {
              operator: "OR",
              cpeMatch: [
                {
                  criteria: "cpe:2.3:a:acme:widget:*:*:*:*:*:*:*:*",
                  vulnerable: true,
                  versionEndExcluding: "2.0.0",
                },
              ],
              nodes: [],
            },
          ],
        },
      }),
    ],
    expectedAffected: [],
  },
] as const);

export function goldenDatasetDigest(): string {
  return createHash("sha256")
    .update(
      JSON.stringify({ purlOsv: GOLDEN_DATASET, cpeNvd: CPE_GOLDEN_DATASET }),
    )
    .digest("hex");
}

export function goldenMetrics() {
  let totalCases = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const purlMetrics = GOLDEN_DATASET.map((testCase) => {
    const actual = new Set(
      evaluatePurlOsvComponent(testCase.component, testCase.candidates)
        .filter((evaluation) => evaluation.outcome === "affected")
        .flatMap((evaluation) =>
          evaluation.canonicalAdvisoryId === undefined
            ? []
            : [evaluation.canonicalAdvisoryId],
        ),
    );
    const expected = new Set<string>(testCase.expectedAffected);
    const fp = [...actual].filter((id) => !expected.has(id)).length;
    const fn = [...expected].filter((id) => !actual.has(id)).length;
    falsePositives += fp;
    falseNegatives += fn;
    totalCases += 1;
    return Object.freeze({
      release: testCase.release,
      ecosystem: testCase.ecosystem,
      method: "purl_osv" as const,
      feed: "osv" as const,
      totalCases: 1,
      falsePositives: fp,
      falseNegatives: fn,
    });
  });
  const cpeMetrics = CPE_GOLDEN_DATASET.map((testCase) => {
    const actual = new Set(
      evaluateCpeNvdComponent(testCase.component, testCase.candidates)
        .filter((evaluation) => evaluation.outcome === "affected")
        .flatMap((evaluation) =>
          evaluation.canonicalAdvisoryId === undefined
            ? []
            : [evaluation.canonicalAdvisoryId],
        ),
    );
    const expected = new Set<string>(testCase.expectedAffected);
    const fp = [...actual].filter((id) => !expected.has(id)).length;
    const fn = [...expected].filter((id) => !actual.has(id)).length;
    falsePositives += fp;
    falseNegatives += fn;
    totalCases += 1;
    return Object.freeze({
      release: testCase.release,
      ecosystem: testCase.ecosystem,
      method: "cpe_nvd" as const,
      feed: "nvd" as const,
      totalCases: 1,
      falsePositives: fp,
      falseNegatives: fn,
    });
  });
  return Object.freeze({
    totalCases,
    falsePositives,
    falseNegatives,
    metrics: [...purlMetrics, ...cpeMetrics],
  });
}
