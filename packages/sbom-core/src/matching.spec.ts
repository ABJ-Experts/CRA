import { describe, it, expect } from "vitest";
import {
  matchComponent,
  isVersionAffected,
  CONFIDENCE,
  type Advisory,
  type AdvisoryLookup,
} from "./matching";
import type { NormalizedComponent } from "./model";

function component(over: Partial<NormalizedComponent>): NormalizedComponent {
  return {
    purl: null,
    cpe: null,
    name: "x",
    version: null,
    ecosystem: null,
    versionNormalised: null,
    depth: 0,
    scope: null,
    supplierName: null,
    hashes: {},
    ...over,
  };
}

const advisories: Advisory[] = [
  {
    advisoryId: "OSV-lodash",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "lodash",
        ranges: [{ introduced: "0", fixed: "4.17.21" }],
      },
    ],
  },
  {
    advisoryId: "OSV-express",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "express",
        ranges: [{ introduced: "4.0.0", fixed: "4.18.0" }],
      },
    ],
  },
  {
    advisoryId: "NVD-openssl",
    source: "nvd",
    affected: [],
    cpeCriteria: [
      {
        cpe: "cpe:2.3:a:openssl:openssl",
        versionStartIncluding: "1.1.1",
        versionEndExcluding: "1.1.2",
        versionSpecific: true,
      },
    ],
  },
];

const lookup: AdvisoryLookup = {
  byPurl: (_type, _ns, name, eco) =>
    advisories.filter((a) =>
      a.affected.some((p) => p.name === name && p.ecosystem === eco),
    ),
  byCpe: (cpe) =>
    advisories.filter((a) =>
      (a.cpeCriteria ?? []).some((c) => cpe.startsWith(c.cpe)),
    ),
};

describe("§10.2 — range evaluation (introduced <= v < fixed)", () => {
  it("is affected below the fix, not affected at/after the fix", () => {
    expect(
      isVersionAffected(
        "4.17.20",
        { introduced: "0", fixed: "4.17.21" },
        "semver",
      ),
    ).toBe(true);
    expect(
      isVersionAffected(
        "4.17.21",
        { introduced: "0", fixed: "4.17.21" },
        "semver",
      ),
    ).toBe(false);
    expect(
      isVersionAffected(
        "3.0.0",
        { introduced: "4.0.0", fixed: "4.18.0" },
        "semver",
      ),
    ).toBe(false);
  });
});

describe("§10.2 — matchComponent Chain of Responsibility", () => {
  it("PURL range match at 0.95 with provenance", () => {
    const r = matchComponent(
      component({
        purl: "pkg:npm/lodash@4.17.20",
        name: "lodash",
        version: "4.17.20",
        ecosystem: "semver",
      }),
      lookup,
    );
    expect(r).toEqual([
      {
        advisoryId: "OSV-lodash",
        method: "purl_range",
        confidence: CONFIDENCE.PURL_RANGE,
      },
    ]);
  });

  it("no finding when the component version is the fixed version", () => {
    const r = matchComponent(
      component({
        purl: "pkg:npm/lodash@4.17.21",
        name: "lodash",
        version: "4.17.21",
        ecosystem: "semver",
      }),
      lookup,
    );
    expect(r).toEqual([]);
  });

  it("a PURL short-circuits CPE (FR-MATCH-002: no duplicate finding)", () => {
    const r = matchComponent(
      component({
        purl: "pkg:npm/express@4.10.0",
        cpe: "cpe:2.3:a:openssl:openssl:1.1.1:*",
        name: "express",
        version: "4.10.0",
        ecosystem: "semver",
      }),
      lookup,
    );
    expect(r.map((c) => c.method)).toEqual(["purl_range"]);
  });

  it("CPE fallback at 0.70 when there is no PURL", () => {
    const r = matchComponent(
      component({
        cpe: "cpe:2.3:a:openssl:openssl:1.1.1:*",
        name: "openssl",
        version: "1.1.1",
      }),
      lookup,
    );
    expect(r).toEqual([
      {
        advisoryId: "NVD-openssl",
        method: "cpe_match",
        confidence: CONFIDENCE.CPE_VERSION_SPECIFIC,
      },
    ]);
  });

  it("no PURL and no CPE yields no auto-finding (heuristic is V2)", () => {
    expect(
      matchComponent(component({ name: "mystery", version: "1.0.0" }), lookup),
    ).toEqual([]);
  });
});
