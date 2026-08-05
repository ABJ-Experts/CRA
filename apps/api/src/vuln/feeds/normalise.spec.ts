// FR-VULN-001 — feed normalisation against committed fixtures. Pure functions,
// no network: this suite must pass with egress blocked (NFR-016), and it is the
// only place the upstream wire formats are pinned down.
import { describe, it, expect } from 'vitest';
import {
  kevCatalogueVersion,
  normaliseEpss,
  normaliseGhsa,
  normaliseKev,
  normaliseNvd,
  normaliseOsv,
  osvEcosystem,
  parseGhsaRange,
} from './normalise';

describe('OSV ecosystem mapping', () => {
  it('maps registries onto the comparator families sbom-core supports', () => {
    expect(osvEcosystem('npm')).toBe('semver');
    expect(osvEcosystem('PyPI')).toBe('pep440');
    expect(osvEcosystem('Go')).toBe('go');
    expect(osvEcosystem('Maven')).toBe('maven');
    // OSV qualifies distro ecosystems with a release: "Debian:12".
    expect(osvEcosystem('Debian:12')).toBe('deb');
    expect(osvEcosystem('Red Hat:rhel_aus:8.2')).toBe('rpm');
  });

  it('refuses to guess for ecosystems we cannot version-compare', () => {
    // Alpine uses apk versions. Treating them as semver would produce confident,
    // wrong findings — worse than none, because an analyst would act on them.
    expect(osvEcosystem('Alpine:v3.19')).toBeNull();
    expect(osvEcosystem('Android')).toBeNull();
    expect(osvEcosystem('OSS-Fuzz')).toBeNull();
    expect(osvEcosystem(undefined)).toBeNull();
  });
});

describe('normaliseOsv', () => {
  it('walks the event stream into disjoint windows, not positional pairs', () => {
    // introduced 0 -> fixed 1.2.3, then introduced 2.0.0 -> fixed 2.1.0.
    // Pairing events positionally would yield a single 0..2.1.0 window that
    // swallows 1.2.3–1.9.x, which were never affected.
    const a = normaliseOsv({
      id: 'OSV-TEST-1',
      summary: 'two windows',
      affected: [
        {
          package: { ecosystem: 'npm', name: 'left-pad' },
          ranges: [
            {
              type: 'SEMVER',
              events: [
                { introduced: '0' },
                { fixed: '1.2.3' },
                { introduced: '2.0.0' },
                { fixed: '2.1.0' },
              ],
            },
          ],
        },
      ],
    });

    expect(a?.affected).toHaveLength(2);
    expect(a?.affected[0]).toMatchObject({ introduced: '0', fixed: '1.2.3' });
    expect(a?.affected[1]).toMatchObject({
      introduced: '2.0.0',
      fixed: '2.1.0',
    });
  });

  it('leaves an unclosed window open (introduced, never fixed)', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-2',
      affected: [
        {
          package: { ecosystem: 'npm', name: 'unfixed' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '1.0.0' }] }],
        },
      ],
    });
    expect(a?.affected).toEqual([
      expect.objectContaining({
        introduced: '1.0.0',
        fixed: null,
        lastAffected: null,
      }),
    ]);
  });

  it('honours last_affected as inclusive, distinct from fixed', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-3',
      affected: [
        {
          package: { ecosystem: 'PyPI', name: 'requests' },
          ranges: [
            {
              type: 'ECOSYSTEM',
              events: [{ introduced: '2.0' }, { last_affected: '2.31.0' }],
            },
          ],
        },
      ],
    });
    expect(a?.affected[0]).toMatchObject({
      ecosystem: 'pep440',
      introduced: '2.0',
      fixed: null,
      lastAffected: '2.31.0',
    });
  });

  it('skips GIT ranges — commit hashes have no version order', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-4',
      affected: [
        {
          package: { ecosystem: 'npm', name: 'thing' },
          ranges: [
            {
              type: 'GIT',
              events: [{ introduced: 'abc123' }, { fixed: 'def456' }],
            },
          ],
        },
      ],
    });
    expect(a?.affected).toHaveLength(0);
  });

  it('falls back to the enumerated versions[] form as exact windows', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-5',
      affected: [
        {
          package: { ecosystem: 'npm', name: 'enumerated' },
          versions: ['1.0.0', '1.0.1'],
        },
      ],
    });
    expect(a?.affected).toHaveLength(2);
    // introduced == lastAffected keeps isVersionAffected's inclusive semantics.
    expect(a?.affected[0]).toMatchObject({
      introduced: '1.0.0',
      lastAffected: '1.0.0',
    });
  });

  it('splits a Maven coordinate into namespace + artifact', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-6',
      affected: [
        {
          package: {
            ecosystem: 'Maven',
            name: 'org.apache.logging.log4j:log4j-core',
          },
          ranges: [
            {
              type: 'ECOSYSTEM',
              events: [{ introduced: '2.0' }, { fixed: '2.17.1' }],
            },
          ],
        },
      ],
    });
    expect(a?.affected[0]).toMatchObject({
      ecosystem: 'maven',
      namespace: 'org.apache.logging.log4j',
      packageName: 'log4j-core',
    });
  });

  it('drops entries in unsupported ecosystems but keeps the rest', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-7',
      affected: [
        {
          package: { ecosystem: 'Alpine:v3.19', name: 'openssl' },
          ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }] }],
        },
        {
          package: { ecosystem: 'npm', name: 'kept' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }],
        },
      ],
    });
    expect(a?.affected).toHaveLength(1);
    expect(a?.affected[0]?.packageName).toBe('kept');
  });

  it('takes the CVSS vector but leaves the base score to NVD', () => {
    const a = normaliseOsv({
      id: 'OSV-TEST-8',
      severity: [
        {
          type: 'CVSS_V3',
          score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        },
      ],
      affected: [],
    });
    expect(a?.cvssVector).toContain('CVSS:3.1');
    // OSV publishes a vector, not a number. Half-computing a base score here
    // would violate ADR-010 (deterministic or nothing).
    expect(a?.cvssBase).toBeNull();
  });

  it('returns null for a document with no id', () => {
    expect(normaliseOsv({ summary: 'nameless' })).toBeNull();
    expect(normaliseOsv(null)).toBeNull();
  });

  // Regression: the split was once applied to Maven only, so a scoped npm
  // package was stored as name "@babel/core" with no namespace while the matcher
  // looked it up by the PURL name "core". The advisory could never match, and a
  // missing finding is invisible. Same shape for Go module paths.
  it.each([
    ['npm', '@babel/core', '@babel', 'core'],
    ['npm', 'lodash', null, 'lodash'],
    ['Go', 'github.com/gin-gonic/gin', 'github.com/gin-gonic', 'gin'],
    [
      'Maven',
      'org.apache.commons:commons-text',
      'org.apache.commons',
      'commons-text',
    ],
    ['PyPI', 'django', null, 'django'],
  ])(
    'reduces a %s coordinate "%s" to PURL shape',
    (ecosystem, name, namespace, packageName) => {
      const a = normaliseOsv({
        id: `OSV-IDENT-${packageName}`,
        affected: [
          {
            package: { ecosystem, name },
            ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }] }],
          },
        ],
      });
      expect(a?.affected[0]).toMatchObject({ namespace, packageName });
    },
  );
});

describe('normaliseNvd', () => {
  const item = {
    cve: {
      id: 'CVE-2021-44228',
      published: '2021-12-10T10:15:09.143',
      lastModified: '2023-11-07T03:39:22.567',
      descriptions: [
        { lang: 'es', value: 'no' },
        {
          lang: 'en',
          value: 'JNDI features do not protect against attacker LDAP',
        },
      ],
      metrics: {
        cvssMetricV31: [
          {
            cvssData: {
              baseScore: 10,
              vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
            },
          },
        ],
        cvssMetricV2: [
          { cvssData: { baseScore: 9.3, vectorString: 'AV:N/AC:M' } },
        ],
      },
      weaknesses: [
        { description: [{ value: 'CWE-917' }, { value: 'NVD-CWE-noinfo' }] },
        { description: [{ value: 'CWE-917' }] },
      ],
      configurations: [
        {
          nodes: [
            {
              cpeMatch: [
                {
                  vulnerable: true,
                  criteria: 'cpe:2.3:a:apache:log4j:*:*:*:*:*:*:*:*',
                  versionStartIncluding: '2.0',
                  versionEndExcluding: '2.15.0',
                },
                {
                  vulnerable: false,
                  criteria: 'cpe:2.3:a:apache:log4j:1.0:*:*:*:*:*:*:*',
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it('prefers CVSS v3.1 over v2 and takes the English description', () => {
    const a = normaliseNvd(item);
    expect(a?.cvssBase).toBe(10);
    expect(a?.cvssVector).toContain('CVSS:3.1');
    expect(a?.summary).toContain('JNDI');
  });

  it('extracts real CWE ids only, deduplicated', () => {
    // "NVD-CWE-noinfo" is a placeholder, not a weakness classification.
    expect(normaliseNvd(item)?.cweIds).toEqual(['CWE-917']);
  });

  it('keeps only vulnerable CPE matches and flags version specificity', () => {
    const cpes = normaliseNvd(item)?.cpes ?? [];
    expect(cpes).toHaveLength(1);
    expect(cpes[0]).toMatchObject({
      versionStartIncluding: '2.0',
      versionEndExcluding: '2.15.0',
      // The version field is a wildcard, so this CPE names a product family.
      versionSpecific: false,
    });
  });

  it('rejects an out-of-range base score rather than failing the batch', () => {
    const a = normaliseNvd({
      cve: {
        id: 'CVE-X',
        metrics: { cvssMetricV31: [{ cvssData: { baseScore: 42 } }] },
      },
    });
    // numeric(3,1) would reject 42 mid-insert and lose the whole sync.
    expect(a?.cvssBase).toBeNull();
  });
});

describe('parseGhsaRange', () => {
  it('separates an exclusive fix from an inclusive last-affected', () => {
    expect(parseGhsaRange('>= 1.0.0, < 1.2.3')).toEqual({
      introduced: '1.0.0',
      fixed: '1.2.3',
      lastAffected: null,
    });
    // "<= 1.2.3" means 1.2.3 IS affected. Recording it as fixed would mark the
    // last vulnerable release safe — off by exactly one version.
    expect(parseGhsaRange('<= 1.2.3')).toEqual({
      introduced: null,
      fixed: null,
      lastAffected: '1.2.3',
    });
  });

  it('handles a bare upper bound and an exact pin', () => {
    expect(parseGhsaRange('< 2.0.0').fixed).toBe('2.0.0');
    expect(parseGhsaRange('= 1.4.2')).toMatchObject({
      introduced: '1.4.2',
      lastAffected: '1.4.2',
    });
  });

  it('is total on junk', () => {
    expect(parseGhsaRange(null).introduced).toBeNull();
    expect(parseGhsaRange('anything at all').introduced).toBeNull();
  });
});

describe('normaliseGhsa', () => {
  it('prefers the CVE id so KEV and EPSS enrichment land on the same row', () => {
    const a = normaliseGhsa({
      ghsa_id: 'GHSA-jfh8-c2jp-5v3q',
      cve_id: 'CVE-2021-44228',
      summary: 'log4shell',
      vulnerabilities: [],
    });
    expect(a?.advisoryId).toBe('CVE-2021-44228');
  });

  it('falls back to the GHSA id when there is no CVE', () => {
    const a = normaliseGhsa({
      ghsa_id: 'GHSA-aaaa-bbbb-cccc',
      cve_id: null,
      vulnerabilities: [],
    });
    expect(a?.advisoryId).toBe('GHSA-aaaa-bbbb-cccc');
  });

  it('lets first_patched_version win over the descriptive range string', () => {
    const a = normaliseGhsa({
      ghsa_id: 'GHSA-x',
      vulnerabilities: [
        {
          package: { ecosystem: 'npm', name: 'lodash' },
          vulnerable_version_range: '<= 4.17.20',
          first_patched_version: { identifier: '4.17.21' },
        },
      ],
    });
    expect(a?.affected[0]).toMatchObject({
      ecosystem: 'semver',
      packageName: 'lodash',
      fixed: '4.17.21',
      lastAffected: null,
    });
  });

  it('maps pip to pep440 and skips ecosystems with no comparator', () => {
    const a = normaliseGhsa({
      ghsa_id: 'GHSA-y',
      vulnerabilities: [
        {
          package: { ecosystem: 'pip', name: 'django' },
          vulnerable_version_range: '< 4.2',
        },
        {
          package: { ecosystem: 'swift', name: 'nope' },
          vulnerable_version_range: '< 1',
        },
      ],
    });
    expect(a?.affected).toHaveLength(1);
    expect(a?.affected[0]?.ecosystem).toBe('pep440');
  });
});

describe('normaliseKev', () => {
  const payload = {
    catalogVersion: '2026.07.28',
    vulnerabilities: [
      { cveID: 'CVE-2021-44228', dateAdded: '2021-12-10' },
      { cveID: 'CVE-2023-4863', dateAdded: '2023-09-13' },
      { dateAdded: '2024-01-01' }, // malformed: no id
    ],
  };

  it('produces enrichment only — KEV never invents an advisory', () => {
    const out = normaliseKev(payload);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      advisoryId: 'CVE-2021-44228',
      kevListed: true,
    });
    expect(out[0]?.kevAddedAt?.toISOString()).toContain('2021-12-10');
  });

  it('exposes the catalogue version as the skip-if-unchanged checkpoint', () => {
    expect(kevCatalogueVersion(payload)).toBe('2026.07.28');
    expect(kevCatalogueVersion({})).toBeNull();
  });
});

describe('normaliseEpss', () => {
  const csv = [
    '#model_version:v2025.03.14,score_date:2026-07-28T00:00:00+0000',
    'cve,epss,percentile',
    'CVE-2021-44228,0.94191,0.99933',
    'CVE-2023-4863,0.00042,0.10000',
    'NOT-A-CVE,0.5,0.5',
    'CVE-BAD-SCORE,7.5,0.1',
    '',
  ].join('\n');

  it('parses scores and lifts the score date as the checkpoint', () => {
    const { enrichments, scoreDate } = normaliseEpss(csv);
    expect(scoreDate).toBe('2026-07-28T00:00:00+0000');
    expect(enrichments).toHaveLength(2);
    expect(enrichments[0]).toEqual({
      advisoryId: 'CVE-2021-44228',
      epssScore: 0.94191,
    });
  });

  it('drops non-CVE rows and probabilities outside 0..1', () => {
    // EPSS is a probability; 7.5 means the file changed shape, and numeric(6,5)
    // would reject it mid-batch.
    const ids = normaliseEpss(csv).enrichments.map((e) => e.advisoryId);
    expect(ids).not.toContain('NOT-A-CVE');
    expect(ids).not.toContain('CVE-BAD-SCORE');
  });
});
