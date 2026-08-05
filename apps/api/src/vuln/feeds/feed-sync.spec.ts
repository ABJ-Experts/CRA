// FR-VULN-001/002 — feed sync against real Postgres, with the network replaced
// by fixtures. Covers the two properties that matter operationally: a re-run
// changes nothing, and a failure does not advance the checkpoint past data that
// was never persisted.
import '../../env';
import { describe, it, expect, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  advisory,
  advisoryAffected,
  advisoryFeedSyncState,
  withFeedWriter,
  closeDb,
} from '../../db';
import { syncFeed } from './feed-sync.service';
import type {
  FeedBatch,
  FeedHttp,
  FeedSource,
  FeedSyncContext,
} from './feed-source';

// Unique per run: the mirror is global and accumulates across the suite.
const SUFFIX = uuidv7().slice(0, 8);
const PKG = `feedpkg-${SUFFIX}`;
const OSV_ID = `OSV-SYNC-${SUFFIX}`;
const CVE_ID = `CVE-2026-${SUFFIX}`;

const noHttp: FeedHttp = {
  getJson: () => Promise.reject(new Error('no network in this suite')),
  postJson: () => Promise.reject(new Error('no network in this suite')),
  getText: () => Promise.reject(new Error('no network in this suite')),
};
const ctx: FeedSyncContext = {
  http: noHttp,
  knownPackages: () => Promise.resolve([]),
};

/** A FeedSource that replays a scripted batch, so the orchestrator is under test. */
class ScriptedSource implements FeedSource {
  public seenCheckpoint: string | null | undefined;
  constructor(
    readonly key: 'osv' | 'nvd' | 'ghsa' | 'kev' | 'epss',
    private readonly batch: FeedBatch | (() => never),
  ) {}
  fetch(checkpoint: string | null): Promise<FeedBatch> {
    this.seenCheckpoint = checkpoint;
    if (typeof this.batch === 'function') this.batch();
    return Promise.resolve(this.batch as FeedBatch);
  }
}

function osvBatch(fixed: string): FeedBatch {
  return {
    advisories: [
      {
        source: 'osv',
        advisoryId: OSV_ID,
        summary: 'scripted',
        cvssBase: null,
        cvssVector: 'CVSS:3.1/AV:N',
        cweIds: ['CWE-79'],
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        modifiedAt: new Date('2026-01-02T00:00:00Z'),
        affected: [
          {
            ecosystem: 'semver',
            packageName: PKG,
            namespace: null,
            introduced: '0',
            fixed,
            lastAffected: null,
          },
        ],
        cpes: [],
      },
    ],
    enrichments: [],
    checkpoint: `ckpt-${fixed}`,
    hasMore: false,
  };
}

async function advisoryRow(): Promise<
  { id: string; kevListed: boolean; epssScore: number | null } | undefined
> {
  const [row] = await withFeedWriter((tx) =>
    tx
      .select({
        id: advisory.id,
        kevListed: advisory.kevListed,
        epssScore: advisory.epssScore,
      })
      .from(advisory)
      .where(eq(advisory.advisoryId, OSV_ID)),
  );
  return row;
}

afterAll(async () => {
  await withFeedWriter((tx) =>
    tx.delete(advisory).where(sql`advisory_id in (${OSV_ID}, ${CVE_ID})`),
  );
  await closeDb();
});

describe('FR-VULN-001 — advisories land in the mirror', () => {
  it('persists an advisory with its affected range and records success', async () => {
    const result = await syncFeed(
      new ScriptedSource('osv', osvBatch('1.2.3')),
      ctx,
    );
    expect(result.advisoriesUpserted).toBe(1);
    expect(result.changedAdvisoryIds).toContain(OSV_ID);

    const row = await advisoryRow();
    expect(row).toBeDefined();

    const ranges = await withFeedWriter((tx) =>
      tx
        .select()
        .from(advisoryAffected)
        .where(eq(advisoryAffected.advisoryPk, row!.id)),
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ packageName: PKG, fixed: '1.2.3' });

    const [state] = await withFeedWriter((tx) =>
      tx
        .select()
        .from(advisoryFeedSyncState)
        .where(eq(advisoryFeedSyncState.feed, 'osv')),
    );
    expect(state?.status).toBe('success');
    expect(state?.lastSuccessAt).toBeInstanceOf(Date);
    expect(state?.checkpoint).toBe('ckpt-1.2.3');
  });

  it('FR-JOB-002 — a re-run is idempotent, not a duplicate', async () => {
    await syncFeed(new ScriptedSource('osv', osvBatch('1.2.3')), ctx);

    const rows = await withFeedWriter((tx) =>
      tx
        .select({ id: advisory.id })
        .from(advisory)
        .where(eq(advisory.advisoryId, OSV_ID)),
    );
    expect(rows).toHaveLength(1);

    const ranges = await withFeedWriter((tx) =>
      tx
        .select()
        .from(advisoryAffected)
        .where(eq(advisoryAffected.advisoryPk, rows[0]!.id)),
    );
    expect(ranges).toHaveLength(1);
  });

  it('FR-MATCH-007 — a narrowed range replaces the old one rather than accumulating', async () => {
    // Upstream corrects the advisory: the fix actually landed in 1.1.0.
    await syncFeed(new ScriptedSource('osv', osvBatch('1.1.0')), ctx);

    const row = await advisoryRow();
    const ranges = await withFeedWriter((tx) =>
      tx
        .select()
        .from(advisoryAffected)
        .where(eq(advisoryAffected.advisoryPk, row!.id)),
    );
    // Merging would leave the stale 1.2.3 window behind and keep flagging
    // versions upstream now says are safe.
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.fixed).toBe('1.1.0');
  });

  it('resumes from the persisted checkpoint on the next run', async () => {
    const source = new ScriptedSource('osv', osvBatch('1.1.0'));
    await syncFeed(source, ctx);
    expect(source.seenCheckpoint).toBe('ckpt-1.1.0');
  });
});

describe('FR-VULN-002 — enrichment patches, never invents', () => {
  it('applies KEV to an advisory that exists', async () => {
    const result = await syncFeed(
      new ScriptedSource('kev', {
        advisories: [],
        enrichments: [
          {
            advisoryId: OSV_ID,
            kevListed: true,
            kevAddedAt: new Date('2026-02-01Z'),
          },
        ],
        checkpoint: '2026.02.01',
        hasMore: false,
      }),
      ctx,
    );
    expect(result.enrichmentsApplied).toBe(1);
    expect((await advisoryRow())?.kevListed).toBe(true);
  });

  it('reports no change when the same catalogue is applied twice', async () => {
    const batch: FeedBatch = {
      advisories: [],
      enrichments: [{ advisoryId: OSV_ID, kevListed: true }],
      checkpoint: '2026.02.01',
      hasMore: false,
    };
    const result = await syncFeed(new ScriptedSource('kev', batch), ctx);
    // Without the is-distinct-from guard, every KEV entry would report as
    // changed every hour and re-trigger reevaluation across the whole estate.
    expect(result.enrichmentsApplied).toBe(0);
    expect(result.changedAdvisoryIds).toHaveLength(0);
  });

  it('silently ignores a score for a CVE nobody has mirrored', async () => {
    const result = await syncFeed(
      new ScriptedSource('epss', {
        advisories: [],
        enrichments: [{ advisoryId: CVE_ID, epssScore: 0.5 }],
        checkpoint: '2026-02-01',
        hasMore: false,
      }),
      ctx,
    );
    expect(result.enrichmentsApplied).toBe(0);

    const rows = await withFeedWriter((tx) =>
      tx.select().from(advisory).where(eq(advisory.advisoryId, CVE_ID)),
    );
    // A bare advisory row with no affected ranges could never yield a finding;
    // creating one would only inflate the mirror's apparent coverage.
    expect(rows).toHaveLength(0);
  });
});

describe('FR-VULN-002 — failure is recorded without losing data', () => {
  it('marks the feed failed and leaves the checkpoint where it was', async () => {
    const [before] = await withFeedWriter((tx) =>
      tx
        .select()
        .from(advisoryFeedSyncState)
        .where(eq(advisoryFeedSyncState.feed, 'osv')),
    );

    const boom = new ScriptedSource('osv', () => {
      throw new Error('upstream 503');
    });
    await expect(syncFeed(boom, ctx)).rejects.toThrow('upstream 503');

    const [after] = await withFeedWriter((tx) =>
      tx
        .select()
        .from(advisoryFeedSyncState)
        .where(eq(advisoryFeedSyncState.feed, 'osv')),
    );
    expect(after?.status).toBe('failed');
    expect(after?.lastError).toContain('upstream 503');
    // Not advancing is the whole point: the next attempt re-reads the window
    // rather than skipping whatever the failed batch contained.
    expect(after?.checkpoint).toBe(before?.checkpoint);
    // lastSuccessAt must not move, or staleness alerting goes blind precisely
    // when the feed is broken.
    expect(after?.lastSuccessAt?.toISOString()).toBe(
      before?.lastSuccessAt?.toISOString(),
    );
    expect(after?.lastAttemptAt?.getTime()).toBeGreaterThanOrEqual(
      before?.lastAttemptAt?.getTime() ?? 0,
    );
  });
});
