// FR-VULN-001/002 — persist a feed batch into the global mirror and record the
// sync outcome. Writes go through withFeedWriter (the elevated cras_feed role,
// BRD §6.1); reads of tenant SBOM content go through withTenant, so nothing here
// widens a tenant query.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { parsePurl, type Ecosystem } from '@repo/sbom-core';
import {
  advisory,
  advisoryAffected,
  advisoryCpe,
  advisoryFeedSyncState,
  sbomComponent,
  withFeedWriter,
  withTenant,
  type Tx,
} from '../../db';
import type {
  AdvisoryEnrichment,
  FeedBatch,
  FeedKey,
  FeedSource,
  FeedSyncContext,
  KnownPackage,
  RawAdvisory,
} from './feed-source';

export interface FeedSyncResult {
  feed: FeedKey;
  advisoriesUpserted: number;
  enrichmentsApplied: number;
  /** Public identifiers whose data actually changed — the reevaluate trigger. */
  changedAdvisoryIds: string[];
  checkpoint: string | null;
  hasMore: boolean;
}

/**
 * The (purlType, namespace, name) set this organisation ships. Derived from the
 * PURL rather than sbom_component.ecosystem because our ecosystem column is the
 * comparator family ("semver") and OSV needs the registry ("npm" vs "crates.io").
 */
export async function knownPackagesForOrganisation(
  organisationId: string,
): Promise<KnownPackage[]> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .selectDistinct({
        purl: sbomComponent.purl,
        name: sbomComponent.name,
        ecosystem: sbomComponent.ecosystem,
      })
      .from(sbomComponent);

    const seen = new Map<string, KnownPackage>();
    for (const row of rows) {
      if (!row.purl || !row.ecosystem) continue;
      const parsed = parsePurl(row.purl);
      if (!parsed) continue;
      const key = `${parsed.type}::${parsed.namespace ?? ''}::${parsed.name}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        purlType: parsed.type,
        namespace: parsed.namespace,
        name: parsed.name,
        ecosystem: row.ecosystem as Ecosystem,
      });
    }
    return [...seen.values()];
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Upsert one advisory and REPLACE its child rows.
 *
 * Replace rather than merge: when upstream narrows a range (a corrected
 * advisory), merging would leave the old wider range behind and keep generating
 * findings for versions upstream now says are safe. FR-MATCH-007 wants a changed
 * verdict surfaced, not silently accumulated.
 */
async function upsertAdvisory(tx: Tx, a: RawAdvisory): Promise<string> {
  const [row] = await tx
    .insert(advisory)
    .values({
      id: uuidv7(),
      source: a.source,
      advisoryId: a.advisoryId,
      summary: a.summary,
      cvssBase: a.cvssBase,
      cvssVector: a.cvssVector,
      cweIds: a.cweIds,
      publishedAt: a.publishedAt,
      modifiedAt: a.modifiedAt,
    })
    .onConflictDoUpdate({
      target: [advisory.source, advisory.advisoryId],
      set: {
        summary: sql`excluded.summary`,
        // Keep an existing score when the incoming feed has none: OSV publishes a
        // vector without a base score, and it must not blank out NVD's number for
        // the same CVE.
        cvssBase: sql`coalesce(excluded.cvss_base, ${advisory.cvssBase})`,
        cvssVector: sql`coalesce(excluded.cvss_vector, ${advisory.cvssVector})`,
        cweIds: sql`case when cardinality(excluded.cwe_ids) > 0
                         then excluded.cwe_ids else ${advisory.cweIds} end`,
        publishedAt: sql`coalesce(excluded.published_at, ${advisory.publishedAt})`,
        modifiedAt: sql`excluded.modified_at`,
      },
    })
    .returning({ id: advisory.id });

  // This upsert has a DO UPDATE branch, so it always returns the row (a DO
  // NOTHING conflict would not). Assert it rather than let an undefined become
  // the advisoryPk on every affected-range row written below.
  if (!row)
    throw new Error(`advisory upsert returned no row for ${a.advisoryId}`);
  const pk = row.id;

  if (a.affected.length > 0) {
    await tx
      .delete(advisoryAffected)
      .where(eq(advisoryAffected.advisoryPk, pk));
    await tx.insert(advisoryAffected).values(
      a.affected.map((r) => ({
        id: uuidv7(),
        advisoryPk: pk,
        ecosystem: r.ecosystem,
        packageName: r.packageName,
        namespace: r.namespace,
        introduced: r.introduced,
        fixed: r.fixed,
        lastAffected: r.lastAffected,
      })),
    );
  }

  if (a.cpes.length > 0) {
    await tx.delete(advisoryCpe).where(eq(advisoryCpe.advisoryPk, pk));
    await tx.insert(advisoryCpe).values(
      a.cpes.map((c) => ({
        id: uuidv7(),
        advisoryPk: pk,
        cpe: c.cpe,
        versionStartIncluding: c.versionStartIncluding,
        versionEndExcluding: c.versionEndExcluding,
        versionSpecific: c.versionSpecific,
      })),
    );
  }

  return a.advisoryId;
}

/**
 * Enrichment patches whatever advisory already carries this public identifier,
 * across every source — a CVE mirrored from GHSA and from NVD both get the KEV
 * flag. It never inserts: an EPSS score for a CVE nobody ships is noise, and a
 * bare advisory row with no affected ranges can never produce a finding.
 */
async function applyEnrichments(
  tx: Tx,
  batch: AdvisoryEnrichment[],
): Promise<{ applied: number; changed: string[] }> {
  if (batch.length === 0) return { applied: 0, changed: [] };

  const changed: string[] = [];
  let applied = 0;

  // Chunked so a full EPSS file (~280k rows) does not build one enormous statement.
  const CHUNK = 500;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    const ids = chunk.map((e) => e.advisoryId);
    const existing = await tx
      .select({ id: advisory.id, advisoryId: advisory.advisoryId })
      .from(advisory)
      .where(inArray(advisory.advisoryId, ids));
    if (existing.length === 0) continue;

    const byPublicId = new Map<string, string[]>();
    for (const row of existing) {
      const list = byPublicId.get(row.advisoryId) ?? [];
      list.push(row.id);
      byPublicId.set(row.advisoryId, list);
    }

    for (const e of chunk) {
      const pks = byPublicId.get(e.advisoryId);
      if (!pks) continue;
      const patch: Record<string, unknown> = {};
      if (e.kevListed !== undefined) patch.kevListed = e.kevListed;
      if (e.kevAddedAt !== undefined) patch.kevAddedAt = e.kevAddedAt;
      if (e.epssScore !== undefined) patch.epssScore = e.epssScore;
      if (Object.keys(patch).length === 0) continue;

      const updated = await tx
        .update(advisory)
        .set(patch)
        .where(
          and(
            inArray(advisory.id, pks),
            // Only touch rows that would actually change. This is what makes a
            // re-run of an unchanged catalogue report zero changes rather than
            // re-triggering reevaluation for every KEV entry every hour.
            e.kevListed !== undefined
              ? sql`${advisory.kevListed} is distinct from ${e.kevListed}`
              : sql`${advisory.epssScore} is distinct from ${e.epssScore ?? null}`,
          ),
        )
        .returning({ advisoryId: advisory.advisoryId });

      if (updated.length > 0) {
        applied += updated.length;
        changed.push(e.advisoryId);
      }
    }
  }

  return { applied, changed };
}

export async function persistBatch(batch: FeedBatch): Promise<{
  advisoriesUpserted: number;
  enrichmentsApplied: number;
  changedAdvisoryIds: string[];
}> {
  return withFeedWriter(async (tx) => {
    const changed = new Set<string>();
    for (const a of batch.advisories) changed.add(await upsertAdvisory(tx, a));
    const enrichment = await applyEnrichments(tx, batch.enrichments);
    for (const id of enrichment.changed) changed.add(id);

    return {
      advisoriesUpserted: batch.advisories.length,
      enrichmentsApplied: enrichment.applied,
      changedAdvisoryIds: [...changed],
    };
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function readCheckpoint(feed: FeedKey): Promise<string | null> {
  const [row] = await withFeedWriter((tx) =>
    tx
      .select({ checkpoint: advisoryFeedSyncState.checkpoint })
      .from(advisoryFeedSyncState)
      .where(eq(advisoryFeedSyncState.feed, feed))
      .limit(1),
  );
  return row?.checkpoint ?? null;
}

async function recordOutcome(
  feed: FeedKey,
  patch: Partial<typeof advisoryFeedSyncState.$inferInsert>,
): Promise<void> {
  await withFeedWriter((tx) =>
    tx
      .update(advisoryFeedSyncState)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(advisoryFeedSyncState.feed, feed)),
  );
}

/**
 * Run one feed to completion for a single pass and record the outcome.
 *
 * `lastSuccessAt` moves only on success. A feed failing every hour therefore has
 * a very recent `lastAttemptAt` and an increasingly stale `lastSuccessAt`, which
 * is exactly the distinction FR-VULN-002's staleness alerting depends on — the
 * dangerous state is "trying and failing", not "not trying".
 */
export async function syncFeed(
  source: FeedSource,
  ctx: FeedSyncContext,
): Promise<FeedSyncResult> {
  const startedAt = new Date();
  await recordOutcome(source.key, {
    status: 'running',
    lastAttemptAt: startedAt,
  });

  try {
    const checkpoint = await readCheckpoint(source.key);
    const batch = await source.fetch(checkpoint, ctx);
    const persisted = await persistBatch(batch);

    await recordOutcome(source.key, {
      status: 'success',
      lastSuccessAt: new Date(),
      checkpoint: batch.checkpoint,
      recordsProcessed:
        persisted.advisoriesUpserted + persisted.enrichmentsApplied,
      lastError: null,
    });

    return {
      feed: source.key,
      ...persisted,
      checkpoint: batch.checkpoint,
      hasMore: batch.hasMore,
    };
  } catch (e) {
    // The checkpoint is deliberately NOT advanced: the next attempt re-reads the
    // same window rather than skipping whatever the failed batch contained.
    await recordOutcome(source.key, {
      status: 'failed',
      lastError: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export interface FeedHealth {
  feed: string;
  status: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  staleHours: number | null;
  recordsProcessed: number;
  lastError: string | null;
}

/** FR-VULN-002 / FR-ADM-006: per-feed status for the system health surface. */
export async function feedHealth(
  organisationId: string,
): Promise<FeedHealth[]> {
  const rows = await withTenant({ organisationId }, (tx) =>
    tx.select().from(advisoryFeedSyncState),
  );
  const now = Date.now();
  return rows.map((r) => ({
    feed: r.feed,
    status: r.status,
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    staleHours: r.lastSuccessAt
      ? Math.floor((now - r.lastSuccessAt.getTime()) / 3_600_000)
      : null,
    recordsProcessed: r.recordsProcessed,
    lastError: r.lastError,
  }));
}
