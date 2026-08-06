// FR-SBOM-002/003/004/007 ingest pipeline against real Postgres with RLS.
import '../env';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation, getOrganisation } from '../org';
import { createProduct } from '../product';
import { createRelease, ingestSbom, rawSbomKey } from './sbom.service';
import { InMemoryStorageProvider } from '../storage';
import { verifyAuditChain } from '../audit';
import { sbomDocument, sbomComponent, withTenant, closeDb } from '../db';

const storage = new InMemoryStorageProvider();
const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex');

const CYCLONEDX = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root', name: 'app' } },
  components: [
    {
      type: 'library',
      'bom-ref': 'a',
      name: 'lodash',
      version: '4.17.20',
      purl: 'pkg:npm/lodash@4.17.20',
    },
    {
      type: 'library',
      'bom-ref': 'b',
      name: 'express',
      version: '4.18.2',
      purl: 'pkg:npm/express@4.18.2',
    },
    {
      type: 'library',
      'bom-ref': 'c',
      name: 'openssl',
      version: '1.1.1w',
      cpe: 'cpe:2.3:a:openssl:openssl:1.1.1w:*:*:*:*:*:*:*',
    },
  ],
  dependencies: [
    { ref: 'root', dependsOn: ['a', 'b'] },
    { ref: 'b', dependsOn: ['c'] },
  ],
});

let userId: string;
let orgId: string;
let releaseId: string;
let otherOrgId: string;

beforeAll(async () => {
  userId = await ensureUserAccount(uuidv7(), 'sbom@acme.test');
  orgId = (
    await createOrganisation(userId, {
      legalName: 'SbomCo',
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'Gateway',
    internalCode: 'GW',
  });
  releaseId = (await createRelease(orgId, userId, product.id, '1.0.0')).id;

  const otherUser = await ensureUserAccount(uuidv7(), 'other@sbom.test');
  otherOrgId = (
    await createOrganisation(otherUser, {
      legalName: 'OtherCo',
      countryMainEstablishment: 'FR',
    })
  ).id;
});

afterAll(async () => {
  await closeDb();
});

describe('FR-SBOM-002/007 — ingest + normalise', () => {
  let docId: string;
  it('parses, hashes, and persists normalised components', async () => {
    const result = await ingestSbom(
      orgId,
      userId,
      releaseId,
      CYCLONEDX,
      storage,
    );
    expect(result.validationStatus).toBe('valid');
    expect(result.componentCount).toBe(3);
    expect(result.deduplicated).toBe(false);
    docId = result.sbomDocumentId;
    const organisation = await getOrganisation(orgId);
    expect(organisation?.onboardingState).toMatchObject({
      step: 'sbom_uploaded',
    });

    const components = await withTenant({ organisationId: orgId }, (tx) =>
      tx
        .select()
        .from(sbomComponent)
        .where(eq(sbomComponent.sbomDocumentId, docId)),
    );
    expect(components).toHaveLength(3);
    const lodash = components.find((c) => c.name === 'lodash');
    expect(lodash?.ecosystem).toBe('semver');
    expect(lodash?.versionNormalised).toBe('4.17.20');
  });

  it('FR-SBOM-012 — an identical re-upload is deduplicated', async () => {
    const again = await ingestSbom(
      orgId,
      userId,
      releaseId,
      CYCLONEDX,
      storage,
    );
    expect(again.deduplicated).toBe(true);
    expect(again.sbomDocumentId).toBe(docId);
  });
});

describe('FR-SBOM-004 — invalid document stored + reported, never dropped', () => {
  it('stores an invalid SBOM with status invalid and no components', async () => {
    const result = await ingestSbom(
      orgId,
      userId,
      releaseId,
      '<xml>not an sbom</xml>',
      storage,
    );
    expect(result.validationStatus).toBe('invalid');
    expect(result.componentCount).toBe(0);
    expect(result.sbomDocumentId).toBeTruthy();
  });
});

describe('FR-SBOM-003 — the byte-exact original is persisted as evidence', () => {
  it('round-trips the raw bytes and they still hash to the recorded value', async () => {
    const [doc] = await withTenant({ organisationId: orgId }, (tx) =>
      tx
        .select({
          rawObjectKey: sbomDocument.rawObjectKey,
          contentHash: sbomDocument.contentHash,
        })
        .from(sbomDocument)
        .where(eq(sbomDocument.contentHash, sha256(CYCLONEDX)))
        .limit(1),
    );
    expect(doc).toBeDefined();
    // The key is derivable from the hash alone — content addressed, so an
    // auditor can locate the original without trusting our row.
    expect(doc?.rawObjectKey).toBe(rawSbomKey(orgId, sha256(CYCLONEDX)));

    const bytes = await storage.get(doc!.rawObjectKey);
    expect(bytes.toString('utf8')).toBe(CYCLONEDX);
    expect(sha256(bytes.toString('utf8'))).toBe(doc?.contentHash);
  });

  it('stores the original of an invalid document too (never dropped)', async () => {
    const invalid = '<xml>not an sbom</xml>';
    const bytes = await storage.get(rawSbomKey(orgId, sha256(invalid)));
    expect(bytes.toString('utf8')).toBe(invalid);
  });
});

describe('tenant isolation + audit', () => {
  it('components are invisible to another org', async () => {
    const rows = await withTenant({ organisationId: otherOrgId }, (tx) =>
      tx.select().from(sbomComponent),
    );
    expect(rows).toHaveLength(0);
  });

  it('ingest events are captured in a verifiable audit chain', async () => {
    const result = await verifyAuditChain(orgId);
    expect(result.ok).toBe(true);
  });

  it('rejects ingest into a release from another org (not found -> 404)', async () => {
    await expect(
      ingestSbom(otherOrgId, userId, releaseId, CYCLONEDX, storage),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
