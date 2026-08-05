// Append-only audit ledger with a per-organisation SHA-256 hash chain (ADR-012 /
// FR-AUD-001/002/003). Each row's content_hash = sha256(canonical(row) + previous
// row's hash), so any tamper breaks the chain from that point forward. Writes take
// a per-org transaction advisory lock so concurrent writers can't fork the head.
import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { auditEvent, withTenant, type Tx, type TenantScope } from '../db';

export type AuditActorType =
  'user' | 'service_account' | 'system' | 'ai' | 'operator';

export interface AuditEventInput {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string; // verb, e.g. 'product.created'
  resourceType: string;
  resourceId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The fields covered by the hash (created_at as ISO for determinism). */
interface HashInput {
  organisationId: string;
  sequence: number;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  correlationId: string | null;
  createdAtIso: string;
}

/** Deterministic serialisation: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

function computeContentHash(
  row: HashInput,
  previousHash: string | null,
): string {
  return createHash('sha256')
    .update(stableStringify(row))
    .update(previousHash ?? '')
    .digest('hex');
}

// Canonicalise a jsonb payload so the HASHED form equals the STORED form:
// jsonb drops `undefined` keys on write, so we must hash the same dropped shape,
// otherwise a read-back verification would see a different value and false-flag a break.
function normaliseJsonb(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export interface AuditWriteResult {
  sequence: number;
  contentHash: string;
}

/**
 * Append one audit event within an existing tenant transaction, so it commits or
 * rolls back atomically with the domain change that triggered it (Observer inside
 * the transaction). Serialises the per-org chain head with an advisory lock.
 */
export async function recordAuditInTx(
  tx: Tx,
  organisationId: string,
  input: AuditEventInput,
): Promise<AuditWriteResult> {
  // Per-org advisory lock held until tx end (ADR-012: don't block the chain head
  // in a long transaction — audit writes should be short).
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organisationId}, 0))`,
  );

  const [head] = await tx
    .select({
      sequence: auditEvent.sequence,
      contentHash: auditEvent.contentHash,
    })
    .from(auditEvent)
    .where(eq(auditEvent.organisationId, organisationId))
    .orderBy(desc(auditEvent.sequence))
    .limit(1);

  const previousHash = head?.contentHash ?? null;
  const sequence = (head?.sequence ?? 0) + 1;
  const createdAt = new Date();
  const beforeState = normaliseJsonb(input.beforeState);
  const afterState = normaliseJsonb(input.afterState);

  const hashInput: HashInput = {
    organisationId,
    sequence,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    beforeState,
    afterState,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
    createdAtIso: createdAt.toISOString(),
  };
  const contentHash = computeContentHash(hashInput, previousHash);

  await tx.insert(auditEvent).values({
    id: uuidv7(),
    organisationId,
    sequence,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    beforeState,
    afterState,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    contentHash,
    previousHash,
    createdAt,
  });

  return { sequence, contentHash };
}

/** Append an audit event in its own tenant transaction (standalone events). */
export async function recordAudit(
  scope: TenantScope,
  input: AuditEventInput,
): Promise<AuditWriteResult> {
  return withTenant(scope, (tx) =>
    recordAuditInTx(tx, scope.organisationId, input),
  );
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  /** First sequence at which the chain is broken (hash mismatch or gap). */
  brokenAtSequence?: number;
}

/** Walk the per-org chain and report the first integrity break (FR-AUD-011). */
export async function verifyAuditChain(
  organisationId: string,
): Promise<ChainVerification> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.organisationId, organisationId))
      .orderBy(asc(auditEvent.sequence));

    let previousHash: string | null = null;
    let expectedSequence = 1;
    for (const r of rows) {
      if (r.sequence !== expectedSequence) {
        return { ok: false, count: rows.length, brokenAtSequence: r.sequence };
      }
      const expected = computeContentHash(
        {
          organisationId,
          sequence: r.sequence,
          actorType: r.actorType,
          actorId: r.actorId,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          beforeState: r.beforeState,
          afterState: r.afterState,
          reason: r.reason,
          correlationId: r.correlationId,
          createdAtIso: r.createdAt.toISOString(),
        },
        previousHash,
      );
      if (
        expected !== r.contentHash ||
        (r.previousHash ?? null) !== previousHash
      ) {
        return { ok: false, count: rows.length, brokenAtSequence: r.sequence };
      }
      previousHash = r.contentHash;
      expectedSequence += 1;
    }
    return { ok: true, count: rows.length };
  });
}
