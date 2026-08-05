import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  FALSE_POSITIVE_REASONS,
  type FalsePositiveReason,
} from '@repo/sbom-core';
import { finding, sbomComponent, withTenant, type Tx } from '../db';
import { recordAuditInTx } from '../audit';
import { DomainError } from '../product';

export { FALSE_POSITIVE_REASONS, type FalsePositiveReason };

/**
 * FR-MATCH-003 — the confidence below which a finding is collapsed by default.
 * Configuration, not a constant in a service class (FR-MATCH-001 makes the same
 * point about confidence itself).
 */
export function confidenceThreshold(): number {
  const raw = process.env.MATCH_CONFIDENCE_THRESHOLD;
  if (!raw) return DEFAULT_CONFIDENCE_THRESHOLD;
  const parsed = Number(raw);
  // A malformed threshold must not silently become 0 and collapse nothing —
  // that would quietly disable the noise control the whole queue depends on.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      `MATCH_CONFIDENCE_THRESHOLD must be a number between 0 and 1, got "${raw}"`,
    );
  }
  return parsed;
}

// Finding State machine (BRD §8.4). Transitions are validated here.
export type FindingState =
  | 'open'
  | 'in_triage'
  | 'awaiting_approval'
  | 'closed'
  | 'suppressed'
  | 'reopened';

const FINDING_TRANSITIONS: Record<FindingState, readonly FindingState[]> = {
  open: ['in_triage', 'suppressed'],
  in_triage: ['awaiting_approval', 'suppressed'],
  awaiting_approval: ['closed', 'in_triage'], // approve -> closed; reject -> in_triage
  closed: ['reopened'],
  suppressed: ['in_triage'],
  reopened: ['in_triage', 'suppressed'],
};

export function canTransitionFinding(
  from: FindingState,
  to: FindingState,
): boolean {
  return FINDING_TRANSITIONS[from].includes(to);
}

export type VexStatus =
  | 'not_assessed'
  | 'under_investigation'
  | 'affected'
  | 'not_affected'
  | 'fixed';

// Permitted VEX justifications (FR-TRI-005). Free text here would make the VEX
// output useless downstream.
export const VEX_JUSTIFICATIONS = [
  'component_not_present',
  'vulnerable_code_not_present',
  'vulnerable_code_not_in_execute_path',
  'vulnerable_code_cannot_be_controlled_by_adversary',
  'inline_mitigations_already_exist',
] as const;
export type VexJustification = (typeof VEX_JUSTIFICATIONS)[number];

export interface FindingView {
  id: string;
  advisoryId: string;
  matchMethod: string;
  matchConfidence: number;
  cvssBase: number | null;
  kevListed: boolean;
  vexStatus: string;
  vexJustification: string | null;
  state: string;
  /**
   * FR-MATCH-003: true when this sits below the confidence threshold. The row is
   * still returned — the requirement is "visible but collapsed by default", not
   * hidden — so the decision to fold it away belongs to the client.
   */
  lowConfidence: boolean;
  falsePositiveReason: string | null;
  version: number;
}

function toView(
  row: typeof finding.$inferSelect,
  threshold: number,
): FindingView {
  return {
    id: row.id,
    advisoryId: row.advisoryId,
    matchMethod: row.matchMethod,
    matchConfidence: row.matchConfidence,
    cvssBase: row.cvssBase,
    kevListed: row.kevListed,
    vexStatus: row.vexStatus,
    vexJustification: row.vexJustification,
    state: row.state,
    lowConfidence: row.matchConfidence < threshold,
    falsePositiveReason: row.falsePositiveReason,
    version: row.version,
  };
}

// FR-TRI-001..003: server-side filter/sort/paginate (Repository + Specification).
export interface FindingFilter {
  state?: FindingState;
  kevOnly?: boolean;
  minCvss?: number;
  productReleaseId?: string;
  limit?: number;
  /**
   * FR-MATCH-003 opt-in narrowing. Omitted, every finding is returned and the
   * lowConfidence flag drives presentation; supplied, low-confidence rows are
   * excluded outright (used by exports and counts, not by the queue).
   */
  minConfidence?: number;
  /** Opaque keyset cursor from a previous page's nextCursor. */
  cursor?: string;
}

/**
 * The queue's sort key, and therefore its cursor.
 *
 * Confidence leads: a 9.8 that is probably not real should not outrank a 7.5
 * that is. Severity orders within a confidence band.
 *
 * `id` breaks ties, and it is not decoration — keyset pagination
 * needs a TOTAL order. Confidence and CVSS tie constantly across a real finding
 * set, and an arbitrary order inside a tied block silently skips or repeats rows
 * across a page boundary.
 *
 * first_detected_at is deliberately NOT part of the key. It was, and it broke
 * pagination outright: the cursor carries the timestamp as JSON,
 * Date.toISOString() truncates to milliseconds, and Postgres stores timestamptz
 * to microseconds. A row written at .711234 compares as AFTER a cursor reading
 * .711000, so every page after the first came back empty. Ordering on id avoids
 * the whole class of problem and loses nothing: ids are UUIDv7, which §8.1 chose
 * precisely because they are time ordered, so id DESC is already newest-first.
 *
 * cvss_base is nullable, and NULL breaks row-value comparison, so it is
 * coalesced to -1 (below every real score) in both the ordering and the cursor.
 */
const CURSOR_ORDER = sql`${finding.matchConfidence} desc, coalesce(${finding.cvssBase}, -1) desc, ${finding.id} desc`;

interface Cursor {
  confidence: number;
  cvss: number;
  id: string;
}

/** Opaque to clients on purpose — the sort key is an implementation detail. */
function encodeCursor(row: typeof finding.$inferSelect): string {
  const c: Cursor = {
    confidence: row.matchConfidence,
    cvss: row.cvssBase ?? -1,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Cursor;
    if (
      typeof c.confidence !== 'number' ||
      typeof c.cvss !== 'number' ||
      typeof c.id !== 'string'
    ) {
      throw new Error('shape');
    }
    return c;
  } catch {
    // A malformed cursor is client input, so it is a 400 rather than a 500 —
    // and silently restarting from page one would look like an infinite list.
    throw new DomainError('validation', 'Malformed cursor');
  }
}

export interface FindingPage {
  items: FindingView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function listFindings(
  organisationId: string,
  filter: FindingFilter = {},
): Promise<FindingPage> {
  const threshold = confidenceThreshold();
  const limit = filter.limit ?? 100;
  return withTenant({ organisationId }, async (tx) => {
    const conditions: SQL[] = [];
    if (filter.state) conditions.push(eq(finding.state, filter.state));
    if (filter.kevOnly) conditions.push(eq(finding.kevListed, true));
    if (filter.minCvss !== undefined)
      conditions.push(gte(finding.cvssBase, filter.minCvss));
    if (filter.productReleaseId) {
      conditions.push(eq(finding.productReleaseId, filter.productReleaseId));
    }
    if (filter.minConfidence !== undefined) {
      conditions.push(gte(finding.matchConfidence, filter.minConfidence));
    }
    if (filter.cursor) {
      const c = decodeCursor(filter.cursor);
      // Row-value comparison against the same expression list the ORDER BY
      // uses. §13.1 bans OFFSET on large tables: it rescans every skipped row,
      // and it double-counts or drops rows when the set shifts underneath.
      conditions.push(
        sql`(${finding.matchConfidence}, coalesce(${finding.cvssBase}, -1), ${finding.id}) < (${c.confidence}::numeric, ${c.cvss}::numeric, ${c.id}::uuid)`,
      );
    }

    // One extra row is the cheapest possible hasMore: no second COUNT query,
    // and no lying about a next page that turns out to be empty.
    const rows = await tx
      .select()
      .from(finding)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(CURSOR_ORDER)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((r) => toView(r, threshold)),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      hasMore,
    };
  });
}

export async function getFinding(
  organisationId: string,
  id: string,
): Promise<FindingView | null> {
  return withTenant({ organisationId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(finding)
      .where(eq(finding.id, id))
      .limit(1);
    return row ? toView(row, confidenceThreshold()) : null;
  });
}

async function loadFinding(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(finding)
    .where(eq(finding.id, id))
    .limit(1);
  if (!row) throw new DomainError('not_found', 'Finding not found');
  return row;
}

export interface TransitionOptions {
  reason?: string;
  suppressionExpiresAt?: Date;
}

export async function transitionFindingState(
  organisationId: string,
  userAccountId: string,
  id: string,
  to: FindingState,
  options: TransitionOptions = {},
): Promise<FindingView> {
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const row = await loadFinding(tx, id);
    const from = row.state as FindingState;
    if (!canTransitionFinding(from, to)) {
      throw new DomainError(
        'invalid_transition',
        `Cannot move finding from ${from} to ${to}`,
      );
    }
    if (to === 'suppressed') {
      // Suppressions always expire (§8.3) and need a reason.
      if (!options.reason)
        throw new DomainError('validation', 'suppression requires a reason');
      if (!options.suppressionExpiresAt) {
        throw new DomainError('validation', 'suppression requires an expiry');
      }
    }
    const [updated] = await tx
      .update(finding)
      .set({
        state: to,
        suppressionExpiresAt:
          to === 'suppressed'
            ? options.suppressionExpiresAt
            : row.suppressionExpiresAt,
        version: row.version + 1,
        updatedBy: userAccountId,
        updatedAt: new Date(),
        lastEvaluatedAt: new Date(),
      })
      .where(and(eq(finding.id, id), eq(finding.version, row.version)))
      .returning();
    if (!updated)
      throw new DomainError('conflict', 'Finding was modified concurrently');
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'finding.state_changed',
      resourceType: 'finding',
      resourceId: id,
      reason: options.reason ?? null,
      beforeState: { state: from },
      afterState: { state: to },
    });
    return toView(updated, confidenceThreshold());
  });
}

export interface VexInput {
  status: VexStatus;
  justification?: VexJustification;
}

/** FR-TRI-004/005: record a VEX assessment; not_affected needs a permitted justification. */
export async function recordVexAssessment(
  organisationId: string,
  userAccountId: string,
  id: string,
  input: VexInput,
): Promise<FindingView> {
  if (
    input.status === 'not_affected' &&
    (!input.justification || !VEX_JUSTIFICATIONS.includes(input.justification))
  ) {
    throw new DomainError(
      'validation',
      'not_affected requires a justification from the permitted VEX set',
    );
  }
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const row = await loadFinding(tx, id);
    // Recording an assessment moves an untriaged finding into triage.
    const nextState: FindingState =
      row.state === 'open' || row.state === 'reopened'
        ? 'in_triage'
        : (row.state as FindingState);
    const [updated] = await tx
      .update(finding)
      .set({
        vexStatus: input.status,
        vexJustification: input.justification ?? null,
        state: nextState,
        version: row.version + 1,
        updatedBy: userAccountId,
        updatedAt: new Date(),
      })
      .where(and(eq(finding.id, id), eq(finding.version, row.version)))
      .returning();
    if (!updated)
      throw new DomainError('conflict', 'Finding was modified concurrently');
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'finding.vex_assessed',
      resourceType: 'finding',
      resourceId: id,
      beforeState: { vexStatus: row.vexStatus },
      afterState: {
        vexStatus: input.status,
        vexJustification: input.justification ?? null,
      },
    });
    return toView(updated, confidenceThreshold());
  });
}

/**
 * FR-MATCH-004 — record that a match was wrong.
 *
 * Deliberately NOT a VEX status. `not_affected` is a statement about the
 * product: the vulnerable code is present but unreachable, and the finding was
 * correct. A false positive says the matcher should never have produced the row
 * at all. Collapsing the two would make the quality metric meaningless, because
 * a thoroughly triaged product would read as a broken matcher.
 */
export async function markFalsePositive(
  organisationId: string,
  userAccountId: string,
  id: string,
  reason: FalsePositiveReason,
): Promise<FindingView> {
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const row = await loadFinding(tx, id);
    const [updated] = await tx
      .update(finding)
      .set({
        falsePositiveReason: reason,
        falsePositiveAt: new Date(),
        falsePositiveBy: userAccountId,
        // A false positive closes the finding — there is nothing to act on. The
        // row stays queryable because the rate is computed from exactly these.
        state: 'closed',
        version: row.version + 1,
        updatedBy: userAccountId,
        updatedAt: new Date(),
      })
      .where(and(eq(finding.id, id), eq(finding.version, row.version)))
      .returning();
    if (!updated)
      throw new DomainError('conflict', 'Finding was modified concurrently');
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'finding.false_positive',
      resourceType: 'finding',
      resourceId: id,
      beforeState: { state: row.state, matchMethod: row.matchMethod },
      afterState: { state: 'closed', falsePositiveReason: reason },
    });
    return toView(updated, confidenceThreshold());
  });
}

export interface FalsePositiveRate {
  dimension: 'method' | 'ecosystem' | 'feed';
  key: string;
  total: number;
  falsePositives: number;
  rate: number;
}

/**
 * FR-MATCH-004 — "Rates by method, ecosystem and feed are reportable."
 *
 * The point of comparison is the golden dataset's own rate. A production rate
 * far above it means the corpus is missing a case that real SBOMs hit, which is
 * the signal that keeps the golden set honest instead of a fixture that
 * ossifies.
 */
export async function falsePositiveRates(
  organisationId: string,
): Promise<FalsePositiveRate[]> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .select({
        method: finding.matchMethod,
        ecosystem: sbomComponent.ecosystem,
        feed: finding.advisorySource,
        total: sql<number>`count(*)::int`,
        falsePositives: sql<number>`count(${finding.falsePositiveReason})::int`,
      })
      .from(finding)
      .innerJoin(sbomComponent, eq(sbomComponent.id, finding.sbomComponentId))
      .groupBy(
        finding.matchMethod,
        sbomComponent.ecosystem,
        finding.advisorySource,
      );

    // One grouped pass, rolled up into the three requested dimensions.
    const acc = new Map<
      string,
      {
        dimension: FalsePositiveRate['dimension'];
        key: string;
        total: number;
        fp: number;
      }
    >();
    const add = (
      dimension: FalsePositiveRate['dimension'],
      key: string,
      total: number,
      fp: number,
    ) => {
      const mapKey = `${dimension}\0${key}`;
      const cur = acc.get(mapKey) ?? { dimension, key, total: 0, fp: 0 };
      cur.total += total;
      cur.fp += fp;
      acc.set(mapKey, cur);
    };
    for (const r of rows) {
      add('method', r.method, r.total, r.falsePositives);
      add('ecosystem', r.ecosystem ?? 'unknown', r.total, r.falsePositives);
      add('feed', r.feed, r.total, r.falsePositives);
    }

    return [...acc.values()]
      .map((v) => ({
        dimension: v.dimension,
        key: v.key,
        total: v.total,
        falsePositives: v.fp,
        rate:
          v.total === 0 ? 0 : Math.round((v.fp / v.total) * 10_000) / 10_000,
      }))
      .sort(
        (a, b) => a.dimension.localeCompare(b.dimension) || b.rate - a.rate,
      );
  });
}
