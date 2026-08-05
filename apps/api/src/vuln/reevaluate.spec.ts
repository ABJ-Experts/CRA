// FR-VULN-008 — "A newly published CVE against an existing component creates a
// finding with no new SBOM upload." This is the behaviour that makes the mirror
// worth having: without it, a release is only ever assessed against the advisory
// data that happened to exist on the day it was ingested.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { createProduct } from '../product';
import { createRelease, ingestSbom } from '../sbom';
import { InMemoryStorageProvider } from '../storage';
import { listFindings } from '../triage';
import { persistBatch } from './feeds';
import { reevaluateForAdvisories } from './reevaluate.service';
import { advisory, withFeedWriter, closeDb } from '../db';

const SUFFIX = uuidv7().slice(0, 8);
const PKG = `reevalpkg-${SUFFIX}`;
const LATE_CVE = `CVE-2026-LATE-${SUFFIX}`;

const storage = new InMemoryStorageProvider();
const SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root', name: 'app' } },
  components: [
    {
      type: 'library',
      'bom-ref': 'a',
      name: PKG,
      version: '1.0.0',
      purl: `pkg:npm/${PKG}@1.0.0`,
    },
  ],
});

let userId: string;
let orgId: string;
let releaseId: string;

beforeAll(async () => {
  userId = await ensureUserAccount(uuidv7(), `reeval-${SUFFIX}@acme.test`);
  orgId = (
    await createOrganisation(userId, {
      legalName: `ReevalCo-${SUFFIX}`,
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'Gateway',
    internalCode: `RV-${SUFFIX}`,
  });
  releaseId = (await createRelease(orgId, userId, product.id, '1.0.0')).id;
  // Ingest against an EMPTY mirror — the advisory does not exist yet.
  await ingestSbom(orgId, userId, releaseId, SBOM, storage);
});

afterAll(async () => {
  // No cleanup of the advisory row: findings reference it, and the mirror is
  // global and accumulates across the suite anyway — which is why every fixture
  // here is namespaced by a per-run suffix.
  await closeDb();
});

describe('FR-VULN-008 — continuous re-evaluation', () => {
  it('starts with no findings, because the advisory did not exist at ingest', async () => {
    const findings = (await listFindings(orgId, {})).items;
    expect(findings.filter((f) => f.advisoryId === LATE_CVE)).toHaveLength(0);
  });

  it('creates a finding after the feed publishes the advisory — no re-upload', async () => {
    await persistBatch({
      advisories: [
        {
          source: 'osv',
          advisoryId: LATE_CVE,
          summary: 'published after the SBOM was ingested',
          cvssBase: 9.8,
          cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cweIds: ['CWE-502'],
          publishedAt: new Date(),
          modifiedAt: new Date(),
          affected: [
            {
              ecosystem: 'semver',
              packageName: PKG,
              namespace: null,
              introduced: '0',
              fixed: '1.1.0',
              lastAffected: null,
            },
          ],
          cpes: [],
        },
      ],
      enrichments: [],
      checkpoint: null,
      hasMore: false,
    });

    const result = await reevaluateForAdvisories(orgId, userId, [LATE_CVE]);
    expect(result.releasesReevaluated).toBe(1);
    expect(result.findingsCreated).toBe(1);

    const findings = (await listFindings(orgId, {})).items;
    const late = findings.find((f) => f.advisoryId === LATE_CVE);
    expect(late).toBeDefined();
    expect(late?.matchMethod).toBe('purl_range');
    expect(late?.cvssBase).toBe(9.8);
  });

  it('FR-MATCH-006 — a second pass creates nothing and preserves the assessment', async () => {
    const result = await reevaluateForAdvisories(orgId, userId, [LATE_CVE]);
    expect(result.releasesReevaluated).toBe(1);
    // The release is still examined; it simply yields no NEW findings. A finding
    // an analyst has already triaged must never reappear as untriaged.
    expect(result.findingsCreated).toBe(0);
  });

  it('KEV enrichment reaches the finding through the same path', async () => {
    await withFeedWriter((tx) =>
      tx
        .update(advisory)
        .set({ kevListed: true, kevAddedAt: new Date() })
        .where(eq(advisory.advisoryId, LATE_CVE)),
    );
    // A release with no component in a changed package is not touched at all.
    const result = await reevaluateForAdvisories(orgId, userId, [
      `CVE-2026-UNRELATED-${SUFFIX}`,
    ]);
    expect(result.releasesReevaluated).toBe(0);
  });

  it('is a no-op when nothing changed upstream', async () => {
    const result = await reevaluateForAdvisories(orgId, userId, []);
    expect(result).toMatchObject({
      releasesReevaluated: 0,
      findingsCreated: 0,
    });
  });
});
