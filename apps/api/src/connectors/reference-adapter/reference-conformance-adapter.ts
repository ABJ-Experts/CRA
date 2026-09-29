import { createHmac, randomBytes } from "node:crypto";
import type {
  ConnectorCapabilities,
  ConnectorConnectionConfig,
  ConnectorPort,
  ConnectorTestResult,
  ExternalRecord,
  PullPage,
  PushRecord,
  PushResult,
  SyncCursor,
} from "../application/connector-port";
import {
  CREATE_SCENARIO_RECORDS,
  isReferenceAdapterScenario,
  REFERENCE_ADAPTER_SCENARIO_RECORDS,
} from "./reference-conformance-fixtures";

const MAX_FIELD_VALUE_LENGTH = 4_000;
/** Calls 1..N return `rate_limited`; call N+1 recovers to a normal page. */
const RATE_LIMITED_CALL_COUNT = 2;

/**
 * Proves the `ConnectorPort` contract against deterministic in-memory
 * fixtures -- no network, no vendor SDK. `scopeFilter.scenario` selects one
 * of the named fixture sets in `reference-conformance-fixtures.ts`;
 * `scopeFilter.simulate` layers the `rate_limit` and `malformed` conformance
 * cases on top of whichever scenario (or the default) would otherwise run.
 */
export class ReferenceConformanceAdapter implements ConnectorPort {
  readonly connectorType = "reference_conformance" as const;
  readonly adapterVersion = "1.0.0";
  readonly mappingVersion = "reference-conformance-v1";

  private readonly rateLimitCallCounts = new Map<
    string,
    Readonly<{ count: number; expiresAt: number }>
  >();
  private readonly cacheIdentityKey = randomBytes(32);

  constructor(
    private readonly clock = Date.now,
    private readonly maximumCacheEntries = 512,
    private readonly cacheLifetimeMs = 300_000,
  ) {
    if (
      !Number.isInteger(maximumCacheEntries) ||
      maximumCacheEntries < 1 ||
      maximumCacheEntries > 512 ||
      !Number.isFinite(cacheLifetimeMs) ||
      cacheLifetimeMs < 1 ||
      cacheLifetimeMs > 300_000
    )
      throw new Error("Invalid reference cache bounds");
  }

  testConnection(
    config: ConnectorConnectionConfig,
  ): Promise<ConnectorTestResult> {
    assertActive(config);
    if (config.scopeFilter?.simulate === "malformed") {
      return Promise.resolve({
        outcome: "failure",
        errorCode: "malformed_response",
        message: "The reference fixture returned a malformed payload.",
      });
    }
    if (config.secretReference.reference.trim().length === 0) {
      return Promise.resolve({
        outcome: "failure",
        errorCode: "auth_failed",
        message: "No fixture secret reference is configured.",
      });
    }
    return Promise.resolve({
      outcome: "success",
      latencyMs: 5,
      adapterVersion: this.adapterVersion,
    });
  }

  discoverCapabilities(
    config?: ConnectorConnectionConfig,
  ): Promise<ConnectorCapabilities> {
    if (config) assertActive(config);
    return Promise.resolve({
      adapterVersion: this.adapterVersion,
      mappingVersion: this.mappingVersion,
      entities: [
        {
          entityType: "product",
          supportsPush: true,
          supportsTombstones: true,
          supportsHierarchy: true,
          fields: [
            productField("name"),
            productField("internalCode"),
            productField("productType"),
            productField("description"),
          ],
        },
        {
          entityType: "release",
          supportsPush: true,
          supportsTombstones: true,
          supportsHierarchy: false,
          fields: [
            releaseField("label"),
            releaseField("releaseVersion"),
            releaseField("description"),
          ],
        },
      ],
    });
  }

  pull(
    config: ConnectorConnectionConfig,
    cursor: SyncCursor | null,
    pageSize: number,
  ): Promise<PullPage> {
    assertActive(config);
    if (config.scopeFilter?.simulate === "malformed") {
      return Promise.resolve(
        paginate(REFERENCE_ADAPTER_SCENARIO_RECORDS.invalid, cursor, pageSize),
      );
    }
    if (config.scopeFilter?.simulate === "rate_limit") {
      const key = this.rateLimitKey(config);
      const now = this.clock();
      for (const [entryKey, entry] of this.rateLimitCallCounts) {
        if (entry.expiresAt <= now) this.rateLimitCallCounts.delete(entryKey);
      }
      const entry = this.rateLimitCallCounts.get(key);
      const callCount = (entry?.count ?? 0) + 1;
      if (!entry && this.rateLimitCallCounts.size >= this.maximumCacheEntries)
        this.rateLimitCallCounts.delete(
          this.rateLimitCallCounts.keys().next().value!,
        );
      this.rateLimitCallCounts.set(key, {
        count: Math.min(callCount, RATE_LIMITED_CALL_COUNT + 1),
        expiresAt: entry?.expiresAt ?? now + this.cacheLifetimeMs,
      });
      if (callCount <= RATE_LIMITED_CALL_COUNT) {
        return Promise.resolve({
          records: Object.freeze([]),
          nextCursor: cursor,
          adapterSignal: "rate_limited",
        });
      }
    }
    const scenario = config.scopeFilter?.scenario;
    const records = isReferenceAdapterScenario(scenario)
      ? REFERENCE_ADAPTER_SCENARIO_RECORDS[scenario]
      : CREATE_SCENARIO_RECORDS;
    return Promise.resolve(paginate(records, cursor, pageSize));
  }

  push(
    config: ConnectorConnectionConfig,
    records: readonly PushRecord[],
  ): Promise<readonly PushResult[]> {
    assertActive(config);
    const now = new Date().toISOString();
    return Promise.resolve(
      Object.freeze(records.map((pushRecord) => validatePush(pushRecord, now))),
    );
  }

  private rateLimitKey(config: ConnectorConnectionConfig): string {
    return createHmac("sha256", this.cacheIdentityKey)
      .update(config.executionIdentity ?? config.secretReference.reference)
      .digest("hex");
  }
}

function validatePush(
  pushRecord: PushRecord,
  externalUpdatedAt: string,
): PushResult {
  if (pushRecord.externalId.trim().length === 0) {
    return {
      outcome: "rejected",
      errorCode: "malformed_response",
      message: "externalId must not be empty.",
    };
  }
  const oversizedField = Object.values(pushRecord.fields).find(
    (value) =>
      typeof value === "string" && value.length > MAX_FIELD_VALUE_LENGTH,
  );
  if (oversizedField !== undefined) {
    return {
      outcome: "rejected",
      errorCode: "payload_too_large",
      message: `A field value exceeds ${MAX_FIELD_VALUE_LENGTH} characters.`,
    };
  }
  return { outcome: "accepted", externalUpdatedAt };
}

/**
 * Sorts by (externalUpdatedAt, externalId) so ordering is deterministic
 * regardless of fixture array order, then returns everything strictly after
 * `cursor`, bounded to `pageSize`. `nextCursor.token` embeds the last
 * returned record's identity so same-timestamp siblings are never skipped
 * nor repeated on the following call.
 *
 * `nextCursor` is `null` once a call drains every currently-available
 * record -- it means "no further page within this call", not "there is
 * nothing new since now". A future incremental run's starting cursor is a
 * watermark the caller (the worker) derives from the last record it
 * actually processed across the whole run, not something read off a
 * possibly-null `nextCursor`.
 */
function paginate(
  records: readonly ExternalRecord[],
  cursor: SyncCursor | null,
  pageSize: number,
): PullPage {
  const sorted = [...records].sort(compareRecords);
  const remaining =
    cursor === null
      ? sorted
      : sorted.filter((record) => isAfterCursor(record, cursor));
  const page = remaining.slice(0, Math.max(1, pageSize));
  const hasMore = remaining.length > page.length;
  const last = page.at(-1);
  return {
    records: Object.freeze(page),
    nextCursor:
      hasMore && last
        ? Object.freeze({
            watermark: last.externalUpdatedAt,
            token: cursorToken(last),
          })
        : null,
    adapterSignal: "ok",
  };
}

function cursorToken(record: ExternalRecord): string {
  return `${record.externalUpdatedAt}|${record.externalId}`;
}

function isAfterCursor(record: ExternalRecord, cursor: SyncCursor): boolean {
  if (record.externalUpdatedAt !== cursor.watermark) {
    return record.externalUpdatedAt > cursor.watermark;
  }
  const lastExternalId = cursor.token.split("|")[1];
  return lastExternalId === undefined
    ? true
    : record.externalId > lastExternalId;
}

function compareRecords(left: ExternalRecord, right: ExternalRecord): number {
  if (left.externalUpdatedAt !== right.externalUpdatedAt) {
    return left.externalUpdatedAt < right.externalUpdatedAt ? -1 : 1;
  }
  return left.externalId < right.externalId
    ? -1
    : left.externalId > right.externalId
      ? 1
      : 0;
}

function assertActive(config: ConnectorConnectionConfig): void {
  if (config.signal?.aborted)
    throw new Error("Connector operation interrupted");
}

function productField(field: string) {
  return {
    field,
    supportsPull: true,
    supportsPush: true,
    vendorFieldPath: field,
  };
}

function releaseField(field: string) {
  return {
    field,
    supportsPull: true,
    supportsPush: true,
    vendorFieldPath: field,
  };
}
