// The golden dataset (FR-MATCH-005). "A golden dataset of known component sets
// with known correct findings runs on every release. False positive and false
// negative rates are release metrics."
//
// This is the MVP exit condition from BRD §25: everything downstream assumes
// analysts trust the queue, and §27.1 rates matching false positives as one of
// only two Critical risks on the project.
//
// Design notes worth reading before adding a case:
//
//  1. There is ONE advisory catalogue and ONE lookup shared by every case, not a
//     per-case fixture. A component is therefore exposed to every OTHER case's
//     advisories, so a matcher that over-reaches produces a visible false
//     positive. Per-case fixtures would hide exactly the defect class this file
//     exists to find.
//  2. Cases assert the FINDING verdict, not version ordering. Ordering is already
//     covered by the comparator specs; §10.3's trap table appears here again
//     because "1.10.0 sorts below 1.9.0" only matters once it becomes a finding
//     somebody has to triage.
//  3. Every case carries `why` — the rule it encodes. A failing case should tell
//     you which rule broke without opening the BRD.

import type { Advisory, AdvisoryLookup } from "../matching";
import type { Ecosystem, NormalizedComponent } from "../model";
import { namespaceMatches } from "../package-identity";

export interface GoldenCase {
  /** Stable identifier. Referenced by golden-metrics.json, so do not rename casually. */
  id: string;
  /** The rule this case encodes, in one line. */
  why: string;
  component: NormalizedComponent;
  /** advisoryIds expected to match. Empty means "must produce no finding". */
  expected: string[];
}

/** Build a NormalizedComponent without restating the unused fields every time. */
function comp(
  name: string,
  version: string | null,
  ecosystem: Ecosystem | null,
  purl: string | null,
  cpe: string | null = null,
): NormalizedComponent {
  return {
    purl,
    cpe,
    name,
    version,
    ecosystem,
    versionNormalised: version,
    depth: 0,
    scope: "required",
    supplierName: null,
    hashes: {},
  };
}

// ---------------------------------------------------------------------------
// Advisory catalogue
// ---------------------------------------------------------------------------
// Namespaces follow the canonical rule in src/package-identity.ts: an upstream
// feed coordinate is reduced to PURL shape, so Maven's "groupId:artifactId", an
// npm scope and a Go module path all yield a namespace, while PyPI, Debian and
// RPM are flat. A null namespace on the advisory means "unscoped" and matches
// any component namespace — which is what lets a Debian advisory (no namespace)
// still match pkg:deb/debian/openssl (namespace "debian").
//
// This corpus asserts that canonical rule. When it was first written the feed
// normaliser only performed the Maven split, so the scoped-npm and Go cases here
// FAILED against production — see splitUpstreamName for the fix.

export const ADVISORIES: Advisory[] = [
  // --- §10.3 trap table ----------------------------------------------------
  {
    advisoryId: "GOLD-SEMVER-PRERELEASE",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "prerelease-lib",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "1.0.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-SEMVER-NUMERIC",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "numeric-lib",
        namespace: null,
        ranges: [{ introduced: "1.0.0", fixed: "1.9.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-DEB-EPOCH",
    source: "osv",
    affected: [
      {
        ecosystem: "deb",
        name: "epoch-pkg",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "2.4" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-DEB-TILDE",
    source: "osv",
    affected: [
      {
        ecosystem: "deb",
        name: "tilde-pkg",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "1.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-RPM-RELEASE",
    source: "osv",
    affected: [
      {
        ecosystem: "rpm",
        name: "release-pkg",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "1.0-2.el8" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-MAVEN-EQUALITY",
    source: "osv",
    affected: [
      {
        ecosystem: "maven",
        name: "equality-artifact",
        namespace: "com.golden",
        ranges: [{ introduced: "0.9", fixed: "1.0.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-PEP440-POST",
    source: "osv",
    affected: [
      {
        ecosystem: "pep440",
        name: "post-pkg",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "1.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-PEP440-RC",
    source: "osv",
    affected: [
      {
        ecosystem: "pep440",
        name: "rc-pkg",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "1.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-GO-BUILDMETA",
    source: "osv",
    affected: [
      {
        ecosystem: "go",
        name: "buildmeta",
        namespace: "example.com",
        ranges: [{ introduced: "v1.0.0", fixed: "v1.2.3" }],
      },
    ],
  },

  // --- range semantics -----------------------------------------------------
  {
    advisoryId: "GOLD-RANGE-BOUNDS",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "bounds-lib",
        namespace: null,
        ranges: [{ introduced: "2.0.0", fixed: "2.5.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-RANGE-LASTAFFECTED",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "lastaffected-lib",
        namespace: null,
        ranges: [{ introduced: "1.0.0", lastAffected: "1.4.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-RANGE-MULTI",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "multirange-lib",
        namespace: null,
        ranges: [
          { introduced: "1.0.0", fixed: "1.2.0" },
          { introduced: "2.0.0", fixed: "2.2.0" },
        ],
      },
    ],
  },
  {
    // Overlapping ranges both admit 3.1.0. The engine must still emit ONE
    // candidate for this advisory, not one per satisfied range.
    advisoryId: "GOLD-RANGE-OVERLAP",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "overlap-lib",
        namespace: null,
        ranges: [
          { introduced: "3.0.0", fixed: "4.0.0" },
          { introduced: "3.1.0", fixed: "3.9.0" },
        ],
      },
    ],
  },

  // --- package identity ----------------------------------------------------
  // Same artifactId, two different groupIds. This pair is the reason the
  // namespace argument exists on AdvisoryLookup.byPurl().
  {
    advisoryId: "GOLD-MAVEN-NS-APACHE",
    source: "osv",
    affected: [
      {
        ecosystem: "maven",
        name: "collision-artifact",
        namespace: "org.apache.golden",
        ranges: [{ introduced: "1.0", fixed: "1.10.0" }],
      },
    ],
  },
  {
    // Deliberately absent from the catalogue as a *matching* advisory for
    // com.example: its range excludes the version under test, so if a
    // namespace-blind lookup ever returns it the case still fails on identity
    // rather than accidentally passing on the range.
    advisoryId: "GOLD-MAVEN-NS-OTHER",
    source: "osv",
    affected: [
      {
        ecosystem: "maven",
        name: "collision-artifact",
        namespace: "com.other.golden",
        ranges: [{ introduced: "5.0", fixed: "6.0" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-ECOSYSTEM-NPM",
    source: "osv",
    affected: [
      {
        ecosystem: "semver",
        name: "shared-name",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "9.9.9" }],
      },
    ],
  },
  {
    advisoryId: "GOLD-NPM-SCOPED",
    source: "ghsa",
    affected: [
      {
        ecosystem: "semver",
        name: "scoped-lib",
        namespace: "@golden",
        ranges: [{ introduced: "0", fixed: "7.1.0" }],
      },
    ],
  },
  {
    // Unscoped advisory: namespace null must match a component that HAS a
    // namespace, because most feeds never populate one.
    advisoryId: "GOLD-UNSCOPED",
    source: "nvd",
    affected: [
      {
        ecosystem: "deb",
        name: "unscoped-pkg",
        namespace: null,
        ranges: [{ introduced: "0", fixed: "3.0" }],
      },
    ],
  },

  // --- layer selection -----------------------------------------------------
  {
    // Reachable only through the CPE layer. A component carrying a PURL must
    // never reach it (FR-MATCH-002).
    advisoryId: "GOLD-CPE-ONLY",
    source: "nvd",
    affected: [],
    cpeCriteria: [
      {
        cpe: "cpe:2.3:a:golden:dual-keyed:2.0.0:*:*:*:*:*:*:*",
        versionSpecific: true,
      },
    ],
  },
  {
    advisoryId: "GOLD-CPE-VERSION-SPECIFIC",
    source: "nvd",
    affected: [],
    cpeCriteria: [
      {
        cpe: "cpe:2.3:o:golden:firmware:1.4.0:*:*:*:*:*:*:*",
        versionSpecific: true,
      },
    ],
  },
  {
    advisoryId: "GOLD-CPE-LOOSE",
    source: "nvd",
    affected: [],
    cpeCriteria: [
      {
        cpe: "cpe:2.3:o:golden:loose-firmware:*:*:*:*:*:*:*:*",
        versionSpecific: false,
        versionStartIncluding: "1.0.0",
        versionEndExcluding: "2.0.0",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const CASES: GoldenCase[] = [
  // --- §10.3 trap table, as finding verdicts -------------------------------
  {
    id: "trap/semver-prerelease-is-below-release",
    why: "§10.3: 1.0.0-alpha sorts BEFORE 1.0.0, so it is still inside a range fixed at 1.0.0",
    component: comp(
      "prerelease-lib",
      "1.0.0-alpha",
      "semver",
      "pkg:npm/prerelease-lib@1.0.0-alpha",
    ),
    expected: ["GOLD-SEMVER-PRERELEASE"],
  },
  {
    id: "trap/semver-release-is-fixed",
    why: "§10.3 companion: the release itself is at the exclusive fixed bound, so it is NOT affected",
    component: comp(
      "prerelease-lib",
      "1.0.0",
      "semver",
      "pkg:npm/prerelease-lib@1.0.0",
    ),
    expected: [],
  },
  {
    id: "trap/semver-numeric-not-string-ordering",
    why: "§10.3: string ordering says 1.10.0 < 1.9.0. It does not. A string compare here is a false positive.",
    component: comp(
      "numeric-lib",
      "1.10.0",
      "semver",
      "pkg:npm/numeric-lib@1.10.0",
    ),
    expected: [],
  },
  {
    id: "trap/deb-epoch-wins",
    why: "§10.3: 1:2.3 is HIGHER than 2.4 because the epoch wins. Ignoring the epoch is a false positive.",
    component: comp(
      "epoch-pkg",
      "1:2.3",
      "deb",
      "pkg:deb/debian/epoch-pkg@1:2.3",
    ),
    expected: [],
  },
  {
    id: "trap/deb-tilde-sorts-first",
    why: "§10.3: a tilde sorts before everything, so 1.0~rc1 is below the 1.0 fix",
    component: comp(
      "tilde-pkg",
      "1.0~rc1",
      "deb",
      "pkg:deb/debian/tilde-pkg@1.0~rc1",
    ),
    expected: ["GOLD-DEB-TILDE"],
  },
  {
    id: "trap/rpm-release-segment-compared-separately",
    why: "§10.3: 1.0-1.el8 is below 1.0-2.el8 on the release segment alone",
    component: comp(
      "release-pkg",
      "1.0-1.el8",
      "rpm",
      "pkg:rpm/redhat/release-pkg@1.0-1.el8",
    ),
    expected: ["GOLD-RPM-RELEASE"],
  },
  {
    id: "trap/maven-1.0-equals-1.0.0",
    why: "§10.3: under Maven rules 1.0 == 1.0.0, and fixed is exclusive, so this is NOT affected",
    component: comp(
      "equality-artifact",
      "1.0",
      "maven",
      "pkg:maven/com.golden/equality-artifact@1.0",
    ),
    expected: [],
  },
  {
    id: "trap/pep440-post-is-higher",
    why: "§10.3: 1.0.post1 is ABOVE 1.0, so the 1.0 fix already covers it",
    component: comp(
      "post-pkg",
      "1.0.post1",
      "pep440",
      "pkg:pypi/post-pkg@1.0.post1",
    ),
    expected: [],
  },
  {
    id: "trap/pep440-rc-is-lower",
    why: "§10.3: 1.0rc1 is a pre-release and therefore below the 1.0 fix",
    component: comp("rc-pkg", "1.0rc1", "pep440", "pkg:pypi/rc-pkg@1.0rc1"),
    expected: ["GOLD-PEP440-RC"],
  },
  {
    id: "trap/go-build-metadata-ignored",
    why: "§10.3: +incompatible is build metadata, ignored in ordering, so this equals the exclusive fix",
    component: comp(
      "buildmeta",
      "v1.2.3+incompatible",
      "go",
      "pkg:golang/example.com/buildmeta@v1.2.3+incompatible",
    ),
    expected: [],
  },

  // --- range semantics -----------------------------------------------------
  {
    id: "range/fixed-is-exclusive",
    why: "A version equal to `fixed` is patched, not affected",
    component: comp(
      "bounds-lib",
      "2.5.0",
      "semver",
      "pkg:npm/bounds-lib@2.5.0",
    ),
    expected: [],
  },
  {
    id: "range/just-below-fixed",
    why: "The last version before the fix is affected",
    component: comp(
      "bounds-lib",
      "2.4.9",
      "semver",
      "pkg:npm/bounds-lib@2.4.9",
    ),
    expected: ["GOLD-RANGE-BOUNDS"],
  },
  {
    id: "range/introduced-is-inclusive",
    why: "A version equal to `introduced` IS affected",
    component: comp(
      "bounds-lib",
      "2.0.0",
      "semver",
      "pkg:npm/bounds-lib@2.0.0",
    ),
    expected: ["GOLD-RANGE-BOUNDS"],
  },
  {
    id: "range/below-introduced",
    why: "A version predating the vulnerability is not affected",
    component: comp(
      "bounds-lib",
      "1.9.9",
      "semver",
      "pkg:npm/bounds-lib@1.9.9",
    ),
    expected: [],
  },
  {
    id: "range/introduced-zero-is-unbounded",
    why: 'introduced "0" is a sentinel for "since the beginning", not a version to compare against',
    component: comp(
      "prerelease-lib",
      "0.0.1",
      "semver",
      "pkg:npm/prerelease-lib@0.0.1",
    ),
    expected: ["GOLD-SEMVER-PRERELEASE"],
  },
  {
    id: "range/below-explicit-introduced-bound",
    why: "An explicit introduced bound (unlike the 0 sentinel) IS compared, and excludes older versions",
    component: comp(
      "numeric-lib",
      "0.0.1",
      "semver",
      "pkg:npm/numeric-lib@0.0.1",
    ),
    expected: [],
  },
  {
    id: "range/last-affected-is-inclusive",
    why: "Unlike `fixed`, `lastAffected` is INCLUSIVE — the boundary version is affected",
    component: comp(
      "lastaffected-lib",
      "1.4.0",
      "semver",
      "pkg:npm/lastaffected-lib@1.4.0",
    ),
    expected: ["GOLD-RANGE-LASTAFFECTED"],
  },
  {
    id: "range/above-last-affected",
    why: "One version past lastAffected is clear",
    component: comp(
      "lastaffected-lib",
      "1.4.1",
      "semver",
      "pkg:npm/lastaffected-lib@1.4.1",
    ),
    expected: [],
  },
  {
    id: "range/second-range-hit",
    why: "An advisory with several disjoint ranges must match on any one of them",
    component: comp(
      "multirange-lib",
      "2.1.0",
      "semver",
      "pkg:npm/multirange-lib@2.1.0",
    ),
    expected: ["GOLD-RANGE-MULTI"],
  },
  {
    id: "range/between-disjoint-ranges",
    why: "The gap between two ranges is not affected",
    component: comp(
      "multirange-lib",
      "1.5.0",
      "semver",
      "pkg:npm/multirange-lib@1.5.0",
    ),
    expected: [],
  },
  {
    id: "range/overlapping-ranges-emit-one-finding",
    why: "Two satisfied ranges on one advisory are one finding, not two (post-pass dedupe)",
    component: comp(
      "overlap-lib",
      "3.1.0",
      "semver",
      "pkg:npm/overlap-lib@3.1.0",
    ),
    expected: ["GOLD-RANGE-OVERLAP"],
  },

  // --- package identity ----------------------------------------------------
  {
    id: "identity/maven-namespace-owner-matches",
    why: "The artifact under its OWN groupId is affected",
    component: comp(
      "collision-artifact",
      "1.9",
      "maven",
      "pkg:maven/org.apache.golden/collision-artifact@1.9",
    ),
    expected: ["GOLD-MAVEN-NS-APACHE"],
  },
  {
    id: "identity/maven-namespace-collision-is-not-a-finding",
    why: "Same artifactId under a DIFFERENT groupId is a different package. Ignoring the namespace is a false positive.",
    component: comp(
      "collision-artifact",
      "1.9",
      "maven",
      "pkg:maven/com.example.golden/collision-artifact@1.9",
    ),
    expected: [],
  },
  {
    id: "identity/same-name-different-ecosystem",
    why: "A name collision across ecosystems is not a match",
    component: comp(
      "shared-name",
      "1.0.0",
      "maven",
      "pkg:maven/com.golden/shared-name@1.0.0",
    ),
    expected: [],
  },
  {
    id: "identity/npm-scope-is-a-namespace",
    why: "An npm scope behaves as a namespace and must be honoured",
    component: comp(
      "scoped-lib",
      "7.0.0",
      "semver",
      "pkg:npm/%40golden/scoped-lib@7.0.0",
    ),
    expected: ["GOLD-NPM-SCOPED"],
  },
  {
    id: "identity/unscoped-advisory-matches-namespaced-component",
    why: "Most feeds never set a namespace; a null advisory namespace must match anything",
    component: comp(
      "unscoped-pkg",
      "2.0",
      "deb",
      "pkg:deb/debian/unscoped-pkg@2.0",
    ),
    expected: ["GOLD-UNSCOPED"],
  },

  // --- layer selection -----------------------------------------------------
  {
    id: "layer/no-purl-no-cpe-produces-nothing",
    why: "§10.2 Layer 3 (heuristic name matching) is V2 and must never auto-open a finding",
    component: comp("mystery-blob", "1.0.0", "semver", null, null),
    expected: [],
  },
  {
    id: "layer/purl-without-version-produces-nothing",
    why: "A component with no version cannot be range-evaluated; guessing would be a false positive",
    component: comp("bounds-lib", null, "semver", "pkg:npm/bounds-lib"),
    expected: [],
  },
  {
    id: "layer/purl-short-circuits-cpe-on-hit",
    why: "FR-MATCH-002: running both layers for one component is the main source of duplicate findings",
    component: comp(
      "bounds-lib",
      "2.4.9",
      "semver",
      "pkg:npm/bounds-lib@2.4.9",
      "cpe:2.3:a:golden:dual-keyed:2.0.0:*:*:*:*:*:*:*",
    ),
    // GOLD-CPE-ONLY is reachable by CPE and must NOT appear.
    expected: ["GOLD-RANGE-BOUNDS"],
  },
  {
    id: "layer/purl-short-circuits-cpe-on-miss",
    why: "The short circuit is on PURL presence, not PURL success — a PURL component never falls back to CPE",
    component: comp(
      "unknown-lib",
      "1.0.0",
      "semver",
      "pkg:npm/unknown-lib@1.0.0",
      "cpe:2.3:a:golden:dual-keyed:2.0.0:*:*:*:*:*:*:*",
    ),
    expected: [],
  },
  {
    id: "layer/cpe-version-specific",
    why: "§10.2 Layer 2: a version-pinned CPE is the higher-confidence fallback",
    component: comp(
      "golden-firmware",
      "1.4.0",
      null,
      null,
      "cpe:2.3:o:golden:firmware:1.4.0:*:*:*:*:*:*:*",
    ),
    expected: ["GOLD-CPE-VERSION-SPECIFIC"],
  },
  {
    id: "layer/cpe-loose-range-inside",
    why: "§10.2 Layer 2: a wildcard CPE with a range still matches, at lower confidence",
    component: comp(
      "golden-loose-firmware",
      "1.5.0",
      null,
      null,
      "cpe:2.3:o:golden:loose-firmware:*:*:*:*:*:*:*:*",
    ),
    expected: ["GOLD-CPE-LOOSE"],
  },
  {
    id: "layer/cpe-loose-range-above-end",
    why: "versionEndExcluding is exclusive on the CPE path too",
    component: comp(
      "golden-loose-firmware",
      "2.0.0",
      null,
      null,
      "cpe:2.3:o:golden:loose-firmware:*:*:*:*:*:*:*:*",
    ),
    expected: [],
  },
];

// ---------------------------------------------------------------------------
// Reference lookup
// ---------------------------------------------------------------------------

/**
 * In-memory AdvisoryLookup over the catalogue. Deliberately a plain scan: this
 * is the reference implementation the production adapter is judged against, so
 * it optimises for being obviously correct rather than fast.
 */
export function corpusLookup(
  advisories: Advisory[] = ADVISORIES,
): AdvisoryLookup {
  return {
    byPurl: (_purlType, namespace, name, ecosystem) =>
      advisories.filter((adv) =>
        adv.affected.some(
          (pkg) =>
            pkg.ecosystem === ecosystem &&
            pkg.name === name &&
            namespaceMatches(pkg.namespace, namespace),
        ),
      ),
    byCpe: (cpe) =>
      advisories.filter((adv) =>
        (adv.cpeCriteria ?? []).some((crit) => crit.cpe === cpe),
      ),
  };
}
