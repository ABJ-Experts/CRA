// FR-EVD-001/003 — evidence upload captures a content hash; retrieval re-verifies
// it and flags tampering. Real PG (RLS), in-memory StorageProvider.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { EvidenceService } from './evidence.service';
import { InMemoryStorageProvider } from '../storage';
import { verifyAuditChain } from '../audit';
import { closeDb } from '../db';

let userId: string;
let orgId: string;
let storage: InMemoryStorageProvider;
let service: EvidenceService;
let id: string;

beforeAll(async () => {
  storage = new InMemoryStorageProvider();
  service = new EvidenceService(storage);
  userId = await ensureUserAccount(uuidv7(), 'evd@acme.test');
  orgId = (
    await createOrganisation(userId, {
      legalName: 'EvdCo',
      countryMainEstablishment: 'DE',
    })
  ).id;
});

afterAll(async () => {
  await closeDb();
});

describe('FR-EVD-001/003 — evidence tamper detection', () => {
  it('uploads with a content hash captured at upload', async () => {
    const v = await service.upload(orgId, userId, {
      title: 'Pen test report',
      classification: 'test_report',
      content: Buffer.from('report body v1'),
      contentType: 'text/plain',
    });
    id = v.id;
    expect(v.contentHash).toHaveLength(64);
    expect(v.tamperState).toBe('intact');
  });

  it('retrieval of intact bytes returns intact + a signed URL', async () => {
    const { evidence, signedUrl } = await service.retrieve(orgId, userId, id);
    expect(evidence.tamperState).toBe('intact');
    expect(signedUrl).toBeTruthy();
  });

  it('retrieval flags tampering when stored bytes change, and withholds the URL', async () => {
    storage.overwriteForTest(
      `evidence/${orgId}/${id}`,
      Buffer.from('tampered!'),
    );
    const { evidence, signedUrl } = await service.retrieve(orgId, userId, id);
    expect(evidence.tamperState).toBe('tampered');
    expect(signedUrl).toBeNull();
  });

  it('the integrity check is captured in a verifiable audit chain', async () => {
    expect((await verifyAuditChain(orgId)).ok).toBe(true);
  });
});
