// FR-ORG-001/002 + FR-PROD-001/002 + §8.4 lifecycle state machine, end to end
// through the services against real Postgres with RLS. Audit + cross-tenant checks.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation, getOrganisation } from '../org';
import {
  createProduct,
  listProducts,
  getProduct,
  transitionLifecycle,
  archiveProduct,
  DomainError,
} from './product.service';
import { verifyAuditChain } from '../audit';
import { closeDb } from '../db';

let userId: string;
let orgId: string;
let otherUserId: string;
let otherOrgId: string;

beforeAll(async () => {
  userId = await ensureUserAccount(uuidv7(), 'owner@acme.test');
  const org = await createOrganisation(userId, {
    legalName: 'Acme GmbH',
    countryMainEstablishment: 'DE',
  });
  orgId = org.id;

  otherUserId = await ensureUserAccount(uuidv7(), 'owner@globex.test');
  const other = await createOrganisation(otherUserId, {
    legalName: 'Globex SA',
    countryMainEstablishment: 'FR',
  });
  otherOrgId = other.id;
});

afterAll(async () => {
  await closeDb();
});

describe('FR-ORG-001 — organisation onboarding', () => {
  it('derives the coordinating CSIRT from the country of main establishment', async () => {
    const org = await getOrganisation(orgId);
    expect(org?.legalName).toBe('Acme GmbH');
    expect(org?.coordinatingCsirt).toBe('CERT-Bund (DE)');
  });
});

describe('FR-PROD-001/002 — product registry', () => {
  it('creates a product in development state', async () => {
    const p = await createProduct(orgId, userId, {
      name: 'Gateway X',
      internalCode: 'GW-X',
    });
    expect(p.lifecycleState).toBe('development');
    expect(p.version).toBe(1);
  });

  it('rejects a duplicate internal code within the org (conflict)', async () => {
    await expect(
      createProduct(orgId, userId, {
        name: 'Gateway X dup',
        internalCode: 'GW-X',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('lists the org products (Repository + Specification)', async () => {
    const list = await listProducts(orgId, { search: 'Gateway' });
    expect(list.map((p) => p.internalCode)).toContain('GW-X');
  });
});

describe('§8.4 — product lifecycle state machine', () => {
  it('rejects placed_on_market without a date', async () => {
    const p = await createProduct(orgId, userId, {
      name: 'Sensor',
      internalCode: 'SEN-1',
    });
    await expect(
      transitionLifecycle(orgId, userId, p.id, 'placed_on_market'),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('allows development -> placed_on_market with a date and bumps the version', async () => {
    const p = await createProduct(orgId, userId, {
      name: 'Sensor2',
      internalCode: 'SEN-2',
    });
    const moved = await transitionLifecycle(
      orgId,
      userId,
      p.id,
      'placed_on_market',
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(moved.lifecycleState).toBe('placed_on_market');
    expect(moved.version).toBe(2);
  });

  it('rejects an illegal transition (development -> in_support)', async () => {
    const p = await createProduct(orgId, userId, {
      name: 'Sensor3',
      internalCode: 'SEN-3',
    });
    await expect(
      transitionLifecycle(orgId, userId, p.id, 'in_support'),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});

describe('tenant isolation + audit', () => {
  it('a product created in another org is invisible here', async () => {
    const foreign = await createProduct(otherOrgId, otherUserId, {
      name: 'Globex Widget',
      internalCode: 'GBX-1',
    });
    expect(await getProduct(orgId, foreign.id)).toBeNull();
    const list = await listProducts(orgId);
    expect(list.map((p) => p.internalCode)).not.toContain('GBX-1');
  });

  it('every change is captured in a verifiable audit chain', async () => {
    const result = await verifyAuditChain(orgId);
    expect(result.ok).toBe(true);
    // org.created + several product.created + lifecycle_changed events.
    expect(result.count).toBeGreaterThanOrEqual(5);
  });

  it('archive soft-deletes and hides the product', async () => {
    const p = await createProduct(orgId, userId, {
      name: 'Temp',
      internalCode: 'TMP-1',
    });
    await archiveProduct(orgId, userId, p.id);
    expect(await getProduct(orgId, p.id)).toBeNull();
  });
});
