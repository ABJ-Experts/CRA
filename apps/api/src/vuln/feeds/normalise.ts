// Pure normalisation from each upstream feed's wire format onto our columns.
// No IO here on purpose: these functions are the part that gets a real test
// suite against committed fixtures, and they must run identically in an air
// gapped deployment reading a bundle from disk (FR-VULN-003, V2).
import { splitUpstreamName, type Ecosystem } from '@repo/sbom-core';
import type {
  AdvisoryEnrichment,
  AffectedRange,
  CpeRange,
  RawAdvisory,
} from './feed-source';

/**
 * OSV names ecosystems far more finely than our comparator set does. Mapping is
 * deliberately conservative: an ecosystem we cannot compare versions for is
 * SKIPPED, never approximated. Guessing semver for Alpine's apk versions would
 * produce confident, wrong findings — the exact failure mode §10.1 warns about,
 * and worse than no finding because an analyst would act on it.
 */
const OSV_ECOSYSTEM: Record<string, Ecosystem> = {
  npm: 'semver',
  'crates.io': 'semver',
  rubygems: 'semver',
  nuget: 'semver',
  packagist: 'semver',
  hex: 'semver',
  pub: 'semver',
  swifturl: 'semver',
  pypi: 'pep440',
  go: 'go',
  maven: 'maven',
  debian: 'deb',
  ubuntu: 'deb',
  'red hat': 'rpm',
  redhat: 'rpm',
  rocky: 'rpm',
  'rocky linux': 'rpm',
  almalinux: 'rpm',
  suse: 'rpm',
  opensuse: 'rpm',
  mageia: 'rpm',
  photon: 'rpm',
  // Deliberately absent: Alpine (apk), Android, Linux, OSS-Fuzz, GIT, Bitnami,
  // Wolfi, Chainguard. No comparator, so no matching — see the rule above.
};

/** OSV writes "Debian:12", "Alpine:v3.19", "Red Hat:rhel_aus:8.2" — take the head. */
export function osvEcosystem(raw: string | undefined): Ecosystem | null {
  if (!raw) return null;
  const head = raw.split(':')[0]?.trim().toLowerCase() ?? '';
  return OSV_ECOSYSTEM[head] ?? null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function asDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A CVSS base score is a fixed-point number stored as numeric(3,1). An upstream
 * value outside 0..10 means the feed changed shape; drop it rather than write a
 * value that will fail the column constraint mid-batch and lose the whole sync.
 */
function asScore(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

// ---------------------------------------------------------------------------
// OSV — https://ossf.github.io/osv-schema/
// ---------------------------------------------------------------------------

/**
 * OSV `affected[].ranges[].events[]` is an ordered event stream, not a list of
 * closed intervals: `{introduced: "0"}, {fixed: "1.2.3"}, {introduced: "2.0.0"}`
 * describes TWO disjoint affected windows. Pairing events positionally is the
 * classic bug here and produces ranges that swallow versions which were never
 * affected, so walk the stream and close a window on each fixed/last_affected.
 */
function osvRanges(
  affectedEntry: Record<string, unknown>,
  ecosystem: Ecosystem,
  packageName: string,
  namespace: string | null,
): AffectedRange[] {
  const out: AffectedRange[] = [];

  for (const rangeRaw of asArray(affectedEntry.ranges)) {
    const range = asRecord(rangeRaw);
    // SEMVER and ECOSYSTEM ranges carry comparable versions; GIT ranges carry
    // commit hashes, which our comparators cannot order.
    const type = asString(range.type);
    if (type === 'GIT') continue;

    let introduced: string | null = null;
    let open = false;
    for (const eventRaw of asArray(range.events)) {
      const event = asRecord(eventRaw);
      const intro = asString(event.introduced);
      const fixed = asString(event.fixed);
      const last = asString(event.last_affected);

      if (intro !== null) {
        // "0" is OSV's "from the beginning"; matching.ts treats it as unbounded.
        introduced = intro;
        open = true;
        continue;
      }
      if (fixed !== null || last !== null) {
        out.push({
          ecosystem,
          packageName,
          namespace,
          introduced,
          fixed,
          lastAffected: last,
        });
        introduced = null;
        open = false;
      }
    }
    // An introduced with no closing event means "affected from here, unfixed".
    if (open) {
      out.push({
        ecosystem,
        packageName,
        namespace,
        introduced,
        fixed: null,
        lastAffected: null,
      });
    }
  }

  // `versions[]` with no ranges is the enumerated form. Each version is its own
  // exact-match window; `introduced == lastAffected` keeps isVersionAffected's
  // inclusive-lower/inclusive-last semantics correct.
  if (out.length === 0) {
    for (const v of asArray(affectedEntry.versions)) {
      const version = asString(v);
      if (version)
        out.push({
          ecosystem,
          packageName,
          namespace,
          introduced: version,
          fixed: null,
          lastAffected: version,
        });
    }
  }

  return out;
}

/** Pull the highest-version CVSS vector OSV carries (v4 > v3.1 > v3.0). */
function osvSeverity(doc: Record<string, unknown>): {
  base: number | null;
  vector: string | null;
} {
  const ranked: { rank: number; vector: string; score: number | null }[] = [];
  for (const sRaw of asArray(doc.severity)) {
    const s = asRecord(sRaw);
    const vector = asString(s.score);
    if (!vector) continue;
    const type = asString(s.type) ?? '';
    const rank = type === 'CVSS_V4' ? 3 : type === 'CVSS_V3' ? 2 : 1;
    ranked.push({ rank, vector, score: null });
  }
  ranked.sort((a, b) => b.rank - a.rank);
  // Replaces a `ranked.length === 0` guard. Same behaviour on an empty list,
  // but this form narrows `best`, so the access below needs no assertion.
  const best = ranked[0];
  if (!best) return { base: null, vector: null };
  // OSV publishes the vector string, not the score. Deriving a base score needs
  // the full CVSS formula; NVD supplies the number for the same CVE, so leave it
  // null here rather than half-computing it (ADR-010: deterministic or nothing).
  return { base: null, vector: best.vector };
}

export function normaliseOsv(doc: unknown): RawAdvisory | null {
  const v = asRecord(doc);
  const advisoryId = asString(v.id);
  if (!advisoryId) return null;

  const affected: AffectedRange[] = [];
  for (const entryRaw of asArray(v.affected)) {
    const entry = asRecord(entryRaw);
    const pkg = asRecord(entry.package);
    const ecosystem = osvEcosystem(asString(pkg.ecosystem) ?? undefined);
    const name = asString(pkg.name);
    if (!ecosystem || !name) continue;

    // Reduce the upstream coordinate to PURL shape, which is what the matcher
    // compares against. Splitting only Maven here (as this did originally) left
    // scoped npm packages and Go modules stored under a name no PURL can ever
    // produce, so they could never match at all.
    const { namespace, name: packageName } = splitUpstreamName(ecosystem, name);

    affected.push(...osvRanges(entry, ecosystem, packageName, namespace));
  }

  const severity = osvSeverity(v);
  const cweIds = asArray(asRecord(v.database_specific).cwe_ids)
    .map(asString)
    .filter((c): c is string => c !== null);

  return {
    source: 'osv',
    advisoryId,
    summary: asString(v.summary) ?? asString(v.details),
    cvssBase: severity.base,
    cvssVector: severity.vector,
    cweIds,
    publishedAt: asDate(v.published),
    modifiedAt: asDate(v.modified),
    affected,
    cpes: [],
  };
}

// ---------------------------------------------------------------------------
// NVD — https://services.nvd.nist.gov/rest/json/cves/2.0
// ---------------------------------------------------------------------------

function nvdCpes(configurations: unknown): CpeRange[] {
  const out: CpeRange[] = [];
  for (const nodeSetRaw of asArray(configurations)) {
    for (const nodeRaw of asArray(asRecord(nodeSetRaw).nodes)) {
      for (const matchRaw of asArray(asRecord(nodeRaw).cpeMatch)) {
        const m = asRecord(matchRaw);
        if (m.vulnerable !== true) continue;
        const cpe = asString(m.criteria);
        if (!cpe) continue;
        const start = asString(m.versionStartIncluding);
        const end = asString(m.versionEndExcluding);
        out.push({
          cpe,
          versionStartIncluding: start,
          versionEndExcluding: end,
          // §10.2: a CPE pinned to one version scores 0.70; a family-wide CPE
          // scores 0.45. "Version specific" means the criteria itself names a
          // version rather than wildcarding it.
          versionSpecific: !cpe.split(':').slice(5, 6).includes('*'),
        });
      }
    }
  }
  return out;
}

export function normaliseNvd(item: unknown): RawAdvisory | null {
  const cve = asRecord(asRecord(item).cve);
  const advisoryId = asString(cve.id);
  if (!advisoryId) return null;

  const metrics = asRecord(cve.metrics);
  // Prefer v3.1, fall back to v3.0, then v2 — the same ordering NVD's own UI uses.
  const metric =
    asArray(metrics.cvssMetricV31)[0] ??
    asArray(metrics.cvssMetricV30)[0] ??
    asArray(metrics.cvssMetricV2)[0];
  const cvssData = asRecord(asRecord(metric).cvssData);

  const cweIds: string[] = [];
  for (const wRaw of asArray(cve.weaknesses)) {
    for (const dRaw of asArray(asRecord(wRaw).description)) {
      const value = asString(asRecord(dRaw).value);
      if (value && /^CWE-\d+$/.test(value)) cweIds.push(value);
    }
  }

  const description =
    asArray(cve.descriptions)
      .map((d) => asRecord(d))
      .find((d) => asString(d.lang) === 'en') ?? {};

  return {
    source: 'nvd',
    advisoryId,
    summary: asString(description.value),
    cvssBase: asScore(cvssData.baseScore, 10),
    cvssVector: asString(cvssData.vectorString),
    cweIds: [...new Set(cweIds)],
    publishedAt: asDate(cve.published),
    modifiedAt: asDate(cve.lastModified),
    // NVD describes affected products as CPE, never as PURL ranges. Those feed
    // FR-VULN-005 CPE matching (V1); the mirror stores them now so enabling that
    // layer is a code change rather than a re-sync of the whole catalogue.
    affected: [],
    cpes: nvdCpes(cve.configurations),
  };
}

// ---------------------------------------------------------------------------
// GHSA — https://api.github.com/advisories
// ---------------------------------------------------------------------------

const GHSA_ECOSYSTEM: Record<string, Ecosystem> = {
  npm: 'semver',
  rubygems: 'semver',
  nuget: 'semver',
  composer: 'semver',
  rust: 'semver',
  erlang: 'semver',
  pub: 'semver',
  pip: 'pep440',
  go: 'go',
  maven: 'maven',
};

/**
 * GitHub publishes a range as a human string: ">= 1.0.0, < 1.2.3". Parse it into
 * our introduced/fixed pair. `<=` is last_affected, not fixed — conflating them
 * would mark the last vulnerable version as safe, off by exactly one release.
 */
export function parseGhsaRange(spec: string | null): {
  introduced: string | null;
  fixed: string | null;
  lastAffected: string | null;
} {
  const result = {
    introduced: null as string | null,
    fixed: null as string | null,
    lastAffected: null as string | null,
  };
  if (!spec) return result;
  for (const clause of spec.split(',')) {
    const m = /^\s*(>=|<=|<|>|=)\s*(\S+)\s*$/.exec(clause);
    if (!m) continue;
    const [, op, version] = m;
    if (op === '>=' || op === '>' || op === '=') result.introduced = version!;
    if (op === '<') result.fixed = version!;
    if (op === '<=') result.lastAffected = version!;
    if (op === '=') result.lastAffected = version!;
  }
  return result;
}

export function normaliseGhsa(item: unknown): RawAdvisory | null {
  const v = asRecord(item);
  // Prefer the CVE id when GitHub has one, so KEV and EPSS enrichment (which key
  // on CVE) land on the same row instead of creating a parallel advisory.
  const advisoryId = asString(v.cve_id) ?? asString(v.ghsa_id);
  if (!advisoryId) return null;

  const affected: AffectedRange[] = [];
  for (const vulnRaw of asArray(v.vulnerabilities)) {
    const vuln = asRecord(vulnRaw);
    const pkg = asRecord(vuln.package);
    const eco = (asString(pkg.ecosystem) ?? '').toLowerCase();
    const ecosystem = GHSA_ECOSYSTEM[eco] ?? null;
    const name = asString(pkg.name);
    if (!ecosystem || !name) continue;

    // Same canonicalisation as the OSV path — see splitUpstreamName.
    const { namespace, name: packageName } = splitUpstreamName(ecosystem, name);

    const range = parseGhsaRange(asString(vuln.vulnerable_version_range));
    // first_patched_version is authoritative when present; the range string is
    // free-form enough that GitHub itself treats it as descriptive.
    const patched = asString(asRecord(vuln.first_patched_version).identifier);
    affected.push({
      ecosystem,
      packageName,
      namespace,
      introduced: range.introduced,
      fixed: patched ?? range.fixed,
      lastAffected: patched ? null : range.lastAffected,
    });
  }

  const cweIds = asArray(v.cwes)
    .map((c) => asString(asRecord(c).cwe_id))
    .filter((c): c is string => c !== null);

  return {
    source: 'ghsa',
    advisoryId,
    summary: asString(v.summary) ?? asString(v.description),
    cvssBase: asScore(asRecord(v.cvss).score, 10),
    cvssVector: asString(asRecord(v.cvss).vector_string),
    cweIds,
    publishedAt: asDate(v.published_at),
    modifiedAt: asDate(v.updated_at),
    affected,
    cpes: [],
  };
}

// ---------------------------------------------------------------------------
// CISA KEV — enrichment only
// ---------------------------------------------------------------------------

export function normaliseKev(payload: unknown): AdvisoryEnrichment[] {
  const out: AdvisoryEnrichment[] = [];
  for (const raw of asArray(asRecord(payload).vulnerabilities)) {
    const v = asRecord(raw);
    const advisoryId = asString(v.cveID);
    if (!advisoryId) continue;
    out.push({
      advisoryId,
      kevListed: true,
      kevAddedAt: asDate(v.dateAdded),
    });
  }
  return out;
}

export function kevCatalogueVersion(payload: unknown): string | null {
  return asString(asRecord(payload).catalogVersion);
}

// ---------------------------------------------------------------------------
// EPSS — enrichment only, CSV
// ---------------------------------------------------------------------------

/**
 * The EPSS file starts with a `#model_version:...,score_date:...` comment line,
 * then a header row, then `cve,epss,percentile`. Scores are probabilities in
 * 0..1 and land in numeric(6,5).
 */
export function normaliseEpss(csv: string): {
  enrichments: AdvisoryEnrichment[];
  scoreDate: string | null;
} {
  const enrichments: AdvisoryEnrichment[] = [];
  let scoreDate: string | null = null;

  for (const line of csv.split('\n')) {
    const row = line.trim();
    if (row.length === 0) continue;
    if (row.startsWith('#')) {
      const m = /score_date:\s*([^,\s]+)/.exec(row);
      if (m) scoreDate = m[1]!;
      continue;
    }
    if (row.startsWith('cve,')) continue; // header

    const [cve, epss] = row.split(',');
    if (!cve || !cve.startsWith('CVE-')) continue;
    const score = asScore(epss, 1);
    if (score === null) continue;
    enrichments.push({ advisoryId: cve, epssScore: score });
  }

  return { enrichments, scoreDate };
}
