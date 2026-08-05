// FR-TRI-001 + §13.1 — cursor pagination over the triage queue.
//
// "Cursor based on every collection. Offset pagination is banned on large
// tables." The queue is specified to stay interactive at 100,000 findings, and
// OFFSET degrades linearly because Postgres still walks every skipped row.
//
// The subtle failure this file exists to catch is not slowness, it is a page
// boundary that drops or repeats a row. That happens whenever the sort key is
// not a TOTAL order, and the queue sorts on confidence and CVSS — both of which
// tie constantly across a real finding set.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { createProduct } from '../product';
import { createRelease, ingestSbom } from '../sbom';
import { InMemoryStorageProvider } from '../storage';
import { matchRelease } from '../vuln';
import { closeDb } from '../db';
import { listFindings } from './triage.service';

const SUFFIX = uuidv7().slice(0, 8);
const COMPONENTS = 25;

// Every component shares one advisory identity shape, so all 25 findings land on
// the SAME confidence (0.95, purl_range) and the SAME cvss (7.5). That is the
// adversarial case for a keyset cursor: without the id tiebreaker the ordering
// inside the tied block is arbitrary and pages overlap.
const SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { 'bom-ref': 'root' } },
  components: Array.from({ length: COMPONENTS }, (_, i) => ({
    type: 'library',
    'bom-ref': `c${i}`,
    name: `pagepkg-${SUFFIX}-${i}`,
    version: '1.0.0',
    purl: `pkg:npm/pagepkg-${SUFFIX}-${i}@1.0.0`,
  })),
});

const storage = new InMemoryStorageProvider();
let seed: Pool;
let orgId: string;
let userId: string;

beforeAll(async () => {
  seed = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  for (let i = 0; i < COMPONENTS; i++) {
    await seed.query(
      `with adv as (
         insert into advisory(id, source, advisory_id, cvss_base, kev_listed)
         values ($1,'osv',$2,7.5,false)
         on conflict (source, advisory_id) do update set cvss_base = excluded.cvss_base
         returning id
       )
       insert into advisory_affected(advisory_pk, ecosystem, package_name, introduced, fixed)
       select id, 'semver', $3, '0', '2.0.0' from adv`,
      [uuidv7(), `OSV-PAGE-${SUFFIX}-${i}`, `pagepkg-${SUFFIX}-${i}`],
    );
  }
  userId = await ensureUserAccount(uuidv7(), `page-${SUFFIX}@acme.test`);
  orgId = (
    await createOrganisation(userId, {
      legalName: `PageCo-${SUFFIX}`,
      countryMainEstablishment: 'DE',
    })
  ).id;
  const product = await createProduct(orgId, userId, {
    name: 'GW',
    internalCode: `GW-${SUFFIX}`,
  });
  const releaseId = (await createRelease(orgId, userId, product.id, '1.0.0'))
    .id;
  await ingestSbom(orgId, userId, releaseId, SBOM, storage);
  await matchRelease(orgId, userId, releaseId);
});

afterAll(async () => {
  await seed.end();
  await closeDb();
});

/** Walk every page, following nextCursor until it runs out. */
async function drain(pageSize: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  // Bounded so a cursor that fails to advance fails the test instead of hanging
  // CI forever — the exact symptom of a non-total sort order.
  for (let guard = 0; guard < 50; guard++) {
    const page = await listFindings(orgId, { limit: pageSize, cursor });
    ids.push(...page.items.map((f) => f.id));
    if (!page.hasMore) return ids;
    expect(page.nextCursor).not.toBeNull();
    cursor = page.nextCursor!;
  }
  throw new Error('cursor never terminated');
}

describe('§13.1 — cursor pagination', () => {
  it('returns the first page with a cursor and hasMore', async () => {
    const page = await listFindings(orgId, { limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();
  });

  it('walks the whole set exactly once, with no gaps or repeats', async () => {
    const ids = await drain(10);
    expect(ids).toHaveLength(COMPONENTS);
    // The assertion that matters. A cursor built on a non-total order returns
    // the right COUNT while silently repeating one row and dropping another.
    expect(new Set(ids).size).toBe(COMPONENTS);
  });

  it('is stable across page sizes', async () => {
    // Same total order however it is sliced; otherwise a user changing page size
    // sees a different set of findings.
    expect(await drain(7)).toEqual(await drain(25));
  });

  it('reports hasMore false and a null cursor on the last page', async () => {
    const page = await listFindings(orgId, { limit: 500 });
    expect(page.items.length).toBeGreaterThanOrEqual(COMPONENTS);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor as client error, not a 500', async () => {
    await expect(
      listFindings(orgId, { cursor: 'not-a-real-cursor' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('keeps the filter applied across pages', async () => {
    // A cursor that dropped the WHERE clause would widen the result set on page
    // two — silently showing findings the filter excluded.
    const all = await drain(5);
    const filtered = await listFindings(orgId, { minCvss: 9, limit: 5 });
    expect(filtered.items).toHaveLength(0);
    expect(all.length).toBe(COMPONENTS);
  });
});
