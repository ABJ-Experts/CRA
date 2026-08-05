// Tier 1 of the accuracy harness: the golden dataset against the PURE matching
// engine, with no database (FR-MATCH-005, BRD §23 "Matching accuracy | Golden
// dataset | Tracked per release").
//
// Tier 2 (apps/api/src/vuln/matching-golden.spec.ts) runs the same corpus through
// the Postgres-backed AdvisoryLookup adapter. The two tiers fail differently: an
// engine defect shows up here, an adapter defect only shows up there. Neither
// tier substitutes for the other.

import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { AdvisoryLookup } from "../matching";
import { ADVISORIES, CASES, corpusLookup } from "./corpus";
import { formatFailures, scoreCase, scoreCorpus } from "./score";
import { ACCURACY_THRESHOLDS, MIN_CORPUS_SIZE } from "./thresholds";

const lookup = corpusLookup();
const report = scoreCorpus(CASES, lookup);

describe("golden dataset — corpus integrity", () => {
  it("has no duplicate case ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("expects only advisories that exist in the catalogue", () => {
    // A typo in an expected id would otherwise read as a permanent false
    // negative and quietly become the accepted baseline.
    const known = new Set(ADVISORIES.map((a) => a.advisoryId));
    const unknown = CASES.flatMap((c) =>
      c.expected.filter((id) => !known.has(id)).map((id) => `${c.id} -> ${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it("has not been gutted", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(MIN_CORPUS_SIZE);
  });

  it("contains negative cases, not only matches", () => {
    // A corpus of nothing but positives cannot detect a matcher that says yes to
    // everything — which is precisely the failure mode §27.1 calls Critical.
    const negatives = CASES.filter((c) => c.expected.length === 0);
    expect(negatives.length).toBeGreaterThanOrEqual(10);
  });

  it("covers every supported ecosystem", () => {
    // §10.3: "If a comparator has no test file, the ecosystem is not supported."
    // The same rule applied one level up — an ecosystem with no finding-level
    // case is not proven end to end.
    const covered = new Set(
      CASES.map((c) => c.component.ecosystem).filter(Boolean),
    );
    for (const eco of ["semver", "deb", "rpm", "maven", "pep440", "go"]) {
      expect(covered, `no golden case for ecosystem ${eco}`).toContain(eco);
    }
  });
});

describe("golden dataset — per case", () => {
  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_id, testCase) => {
    const result = scoreCase(testCase, lookup);
    const actualIds = result.actual.map((c) => c.advisoryId).sort();

    expect(
      actualIds,
      `${testCase.why}\n  false positives: ${result.falsePositives
        .map((c) => c.advisoryId)
        .join(", ")}\n  false negatives: ${result.falseNegatives.join(", ")}`,
    ).toEqual([...testCase.expected].sort());
  });
});

describe("golden dataset — release metrics", () => {
  it(`precision >= ${ACCURACY_THRESHOLDS.MIN_PRECISION}`, () => {
    expect(report.precision, formatFailures(report)).toBeGreaterThanOrEqual(
      ACCURACY_THRESHOLDS.MIN_PRECISION,
    );
  });

  it(`recall >= ${ACCURACY_THRESHOLDS.MIN_RECALL}`, () => {
    expect(report.recall, formatFailures(report)).toBeGreaterThanOrEqual(
      ACCURACY_THRESHOLDS.MIN_RECALL,
    );
  });

  it("reports a breakdown by method and by ecosystem (FR-MATCH-004)", () => {
    expect(Object.keys(report.byMethod)).toContain("purl_range");
    expect(Object.keys(report.byMethod)).toContain("cpe_match");
    expect(Object.keys(report.byEcosystem).length).toBeGreaterThanOrEqual(6);
  });
});

describe("AdvisoryLookup port contract", () => {
  // The production adapter is a different implementation of this same port. If
  // the engine stops passing the namespace, or an adapter ignores it, Maven
  // artifacts sharing an artifactId under different groupIds collide. Pinning
  // the call shape here is what makes that a caught regression rather than a
  // silent false positive in a customer's queue.
  it("passes the PURL namespace through to byPurl", () => {
    const calls: Array<[string, string | null, string, string]> = [];
    const spy: AdvisoryLookup = {
      byPurl: (type, namespace, name, ecosystem) => {
        calls.push([type, namespace, name, ecosystem]);
        return lookup.byPurl(type, namespace, name, ecosystem);
      },
      byCpe: (cpe) => lookup.byCpe(cpe),
    };

    const mavenCase = CASES.find(
      (c) => c.id === "identity/maven-namespace-owner-matches",
    );
    expect(mavenCase).toBeDefined();
    scoreCase(mavenCase!, spy);

    expect(calls).toEqual([
      ["maven", "org.apache.golden", "collision-artifact", "maven"],
    ]);
  });

  it("never consults byCpe for a component that carries a PURL (FR-MATCH-002)", () => {
    let cpeCalls = 0;
    const spy: AdvisoryLookup = {
      byPurl: (t, ns, n, e) => lookup.byPurl(t, ns, n, e),
      byCpe: (cpe) => {
        cpeCalls += 1;
        return lookup.byCpe(cpe);
      },
    };

    for (const c of CASES.filter(
      (c) => c.component.purl && c.component.version,
    )) {
      scoreCase(c, spy);
    }
    expect(cpeCalls).toBe(0);
  });
});

afterAll(() => {
  // FR-MATCH-005 / §23: accuracy is a per-release metric, so it is written as a
  // committed artifact and not merely asserted. Deliberately deterministic — no
  // timestamp — so the file's diff changes if and only if the ACCURACY changes.
  // A timestamp would make every run a diff and train reviewers to ignore it.
  const artifact = {
    _generated:
      "packages/sbom-core/src/golden/golden.spec.ts — do not edit by hand",
    thresholds: ACCURACY_THRESHOLDS,
    corpusSize: report.corpusSize,
    expectedFindings: report.expectedFindings,
    truePositives: report.tp,
    falsePositives: report.fp,
    falseNegatives: report.fn,
    precision: report.precision,
    recall: report.recall,
    byMethod: report.byMethod,
    byEcosystem: report.byEcosystem,
    failingCases: report.failures.map((f) => f.id),
  };
  writeFileSync(
    new URL("../../golden-metrics.json", import.meta.url),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
});
