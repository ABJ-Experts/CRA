import { createConnectorSyncPlanContext } from "./connector-sync-plan-context";
export { createConnectorSyncPlanContext } from "./connector-sync-plan-context";
import { Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeIdentity } from "../application/identity-matching-policy";

import type {
  ConnectorConnectionConfig,
  ConnectorPort,
  ConnectorType,
  ExternalRecord,
  ConnectorCapabilities,
} from "../application/connector-port";
import { planExternalRecord } from "../application/sync-plan-builder";
import { SupabaseConnectorRepository } from "../infrastructure/supabase-connector.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
import type {
  ConnectorCredentialReaderPort,
  ConnectorVaultPort,
} from "../application/connector-vault.port";
import type { ConnectorAuthorizationPort } from "../application/connector-authorization.port";
import type {
  ConnectorHubContext,
  ConnectorHubRepository,
  ConnectorEgressPolicy,
} from "../application/connector-hub-repository.port";
import type { PermissionKey } from "@repo/contracts/permissions";
import {
  connectorCapabilitiesSchema,
  connectorFieldMappingsSchema,
  connectorExternalRecordSchema,
  connectorPullPageSchema,
  syncProposedActionSchema,
  testConnectorResultSchema,
} from "@repo/contracts/connectors/schemas";
import type { ConnectorFieldMapping } from "@repo/contracts/connectors/types";
import {
  applyConnectorFieldMappings,
  protectConnectorSourceRecord,
  hasConnectorCredentialEcho,
} from "../application/connector-field-mapping-policy";
import {
  classifyConnectorWorkerFailure,
  ConnectorWorkerFailure,
} from "./connector-worker-failure";

const configuredMaximumClaims = Number(
  process.env.CONNECTOR_SYNC_MAX_CLAIMS_PER_CYCLE ?? 200,
);
const maximumClaimsPerCycle =
  Number.isSafeInteger(configuredMaximumClaims) &&
  configuredMaximumClaims > 0 &&
  configuredMaximumClaims <= 200
    ? configuredMaximumClaims
    : 200;
const pullPageSize = 200;
const externalRecordSchema = connectorExternalRecordSchema;
// Preserve individual malformed records for review; the provider envelope stays strict.
const pullPageSchema = connectorPullPageSchema.extend({
  records: z.array(z.unknown()).max(pullPageSize),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

type ClaimedSyncRun = Readonly<{
  id: string;
  organizationId: string;
  connectorId: string;
  workKind: "dry_run" | "commit";
  cursorFrom: string | null;
  cursorTo: string | null;
  fetchContentHash: string | null;
  correlationId: string | null;
  actorId: string | null;
  commitActorId: string | null;
  connectionRevision: number | null;
  credentialRevision: number | null;
  permissionVersion: number | null;
  leaseGeneration: number;
  fieldMappingSnapshot: readonly ConnectorFieldMapping[];
  fieldMappingRevision: number;
  schemaSnapshot: ConnectorCapabilities | null;
  replaySourceMode: "retained" | "refetch" | null;
  replaySourceRecords: readonly unknown[];
}>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Framework-free, direct port of ProductImportWorker's tenant-fair round-robin claim loop. */
export class ConnectorSyncWorker {
  private readonly logger = new Logger(ConnectorSyncWorker.name);

  constructor(
    private readonly repository: SupabaseConnectorRepository,
    private readonly supabase: SupabaseService,
    private readonly adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
    _legacyEncryptionKey: string,
    private readonly workerId: string,
    private readonly leaseSeconds = 60,
    private readonly security?: Readonly<{
      vault: ConnectorVaultPort;
      credentialReader?: ConnectorCredentialReaderPort;
      egress?: ConnectorEgressPolicy;
      authorization: ConnectorAuthorizationPort;
      hub: ConnectorHubRepository;
    }>,
  ) {}

  async runOnce(): Promise<void> {
    const dueRows = await this.repository.listDueSyncRunOrganizations(500);
    let due = unique(dueRows.map((row) => String(row.organization_id)));
    let remaining = maximumClaimsPerCycle;
    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        const claimed = await this.processOne(organizationId);
        if (claimed) {
          remaining -= 1;
          nextRound.push(organizationId);
        }
      }
      due = nextRound;
    }
  }

  /** Returns true if this org may still have more due work this cycle. */
  private async processOne(organizationId: string): Promise<boolean> {
    const claimed = await this.repository.claimSyncRun(
      organizationId,
      this.workerId,
      this.leaseSeconds,
    );
    if (!claimed) return false;
    const run = toClaimedSyncRun(claimed);
    if (run.organizationId !== organizationId)
      throw new Error("Connector claim tenant mismatch");

    try {
      if (run.workKind === "commit") {
        await this.applyCommit(run);
      } else {
        await this.buildAndSavePlan(run);
      }
    } catch (error) {
      this.logger.warn(
        `connector_sync_worker_cycle_failed_safely run=${String(run.id)} organization=${organizationId}`,
      );
      const failure = classifyConnectorWorkerFailure(error);
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        failure.code,
        run.leaseGeneration,
        failure.retryable,
        failure.retryAfterSeconds,
      );
    }
    return true;
  }

  private async applyCommit(run: ClaimedSyncRun): Promise<void> {
    const organizationId = run.organizationId;
    await this.assertAuthorized(run);
    const { data: actions, error } = await this.supabase
      .admin()
      .rpc("m11_sync_run_required_product_actions", {
        p_organization_id: organizationId,
        p_sync_run_id: run.id,
      });
    if (error) throw new ConnectorWorkerFailure("transient_database");
    const productPermissions = productPermissionsFor(
      syncProposedActionSchema
        .array()
        .max(syncProposedActionSchema.options.length)
        .parse(actions),
    );
    await this.assertAuthorized(run, productPermissions);
    const actorId = run.commitActorId;
    if (!actorId) throw new ConnectorWorkerFailure("authorization_changed");
    const approval = await this.security!.authorization.authorize(
      organizationId,
      actorId,
      ["can_approve_connectors", ...productPermissions],
    );
    if (
      approval.permissionVersion !== run.permissionVersion ||
      approval.organizationId !== organizationId ||
      approval.actorId !== actorId
    )
      throw new ConnectorWorkerFailure("authorization_changed");
    const result = await this.repository.commitSyncRun({
      p_organization_id: organizationId,
      p_sync_run_id: run.id,
      p_actor_user_id: actorId,
      p_fetch_content_hash: run.fetchContentHash,
      p_idempotency_key: run.id,
      p_correlation_id: run.correlationId ?? randomUUID(),
      p_worker_id: this.workerId,
      p_generation: run.leaseGeneration,
    });
    // SQL owns completed effects and scheduled retries. Early fenced exits still
    // need a terminal attempt while this generation holds its lease.
    if (
      [
        "completed",
        "retrying",
        "failed",
        "lease_lost",
        "not_found",
        "waiting_for_review",
      ].includes(String(result.outcome))
    )
      return;
    if (result.outcome === "invalid_state")
      throw new ConnectorWorkerFailure("authorization_changed");
    if (result.outcome === "blocked_by_records")
      throw new ConnectorWorkerFailure("invalid_data");
    throw new ConnectorWorkerFailure("stale_preview");
  }

  private async buildAndSavePlan(run: ClaimedSyncRun): Promise<void> {
    const organizationId = run.organizationId;
    const connectorId = run.connectorId;
    const securedContext = await this.assertAuthorized(run);
    const connector = securedContext.connector;
    const adapter = this.adapters.get(connector.connectorType);
    if (!adapter) {
      throw new ConnectorWorkerFailure("unsupported_connector_type");
    }

    let capabilities: ConnectorCapabilities;
    let credentialCanary: string | null = null;
    let sourceRecords: readonly unknown[];
    let cursorTo: string | null;
    if (run.replaySourceMode === "retained") {
      if (!run.schemaSnapshot)
        throw new ConnectorWorkerFailure("stale_preview");
      capabilities = run.schemaSnapshot;
      sourceRecords = run.replaySourceRecords;
      cursorTo = run.cursorTo;
    } else {
      const secret = securedContext.secret;
      if (connector.hasSecret && !secret)
        throw new ConnectorWorkerFailure("vault_unavailable");
      const secretContext = secret
        ? {
            orgId: organizationId,
            connectorId,
            secretId: secret.secretId,
            credentialRevision: secret.credentialRevision,
          }
        : null;
      let secretValue: string | null = null;
      if (secret && secretContext) {
        if (this.security!.credentialReader)
          secretValue = await this.security!.credentialReader.read(
            secretContext,
            secret,
          );
        else if (secret.envelope && !secret.legacy)
          secretValue = this.security!.vault.decrypt(
            secretContext,
            secret.envelope,
          );
        else throw new ConnectorWorkerFailure("vault_unavailable");
      }
      const config: ConnectorConnectionConfig = {
        connectorType: connector.connectorType,
        ...connector.connectionConfig,
        organizationId,
        connectorId,
        secretReference: { provider: "vault", reference: secretValue ?? "" },
        executionIdentity: `${organizationId}:${connectorId}:${run.id}`,
        signal: AbortSignal.timeout(15_000),
      };
      credentialCanary = secretValue;
      await this.assertEgress(connector.connectionConfig, config.signal!);
      const connectionResult = testConnectorResultSchema.parse(
        await withDeadline(adapter.testConnection(config), config.signal!),
      );
      if (connectionResult.outcome === "failure") {
        throw new ConnectorWorkerFailure(
          connectionResult.errorCode === "unreachable"
            ? "provider_unavailable"
            : connectionResult.errorCode,
        );
      }
      await this.assertAuthorized(run);
      await this.assertEgress(connector.connectionConfig, config.signal!);
      const discovered = connectorCapabilitiesSchema.parse(
        await withDeadline(
          adapter.discoverCapabilities(config),
          config.signal!,
        ),
      );
      if (
        credentialCanary &&
        hasConnectorCredentialEcho(
          [
            discovered.adapterVersion,
            discovered.mappingVersion,
            ...discovered.entities.flatMap((entry) =>
              entry.fields.flatMap((field) => [
                field.field,
                field.vendorFieldPath,
              ]),
            ),
          ],
          credentialCanary,
        )
      )
        throw new ConnectorWorkerFailure("malformed_response");
      // The pinned interpretation is immutable; discovery cannot silently rebase a run.
      if (
        run.schemaSnapshot &&
        JSON.stringify(run.schemaSnapshot) !== JSON.stringify(discovered)
      )
        throw new ConnectorWorkerFailure("stale_preview");
      capabilities = run.schemaSnapshot ?? discovered;
      await this.assertAuthorized(run);
      await this.assertEgress(connector.connectionConfig, config.signal!);
      const page = pullPageSchema.parse(
        await withDeadline(
          adapter.pull(config, cursorInputFor(run.cursorFrom), pullPageSize),
          config.signal!,
        ),
      );
      if (page.adapterSignal !== "ok")
        throw new ConnectorWorkerFailure(
          page.adapterSignal === "unavailable"
            ? "provider_unavailable"
            : page.adapterSignal,
          page.retryAfterSeconds ?? null,
        );
      sourceRecords = page.records;
      if (
        credentialCanary &&
        page.nextCursor &&
        (page.nextCursor.token.includes(credentialCanary) ||
          page.nextCursor.watermark.includes(credentialCanary))
      ) {
        throw new ConnectorWorkerFailure("malformed_response");
      }
      cursorTo = cursorAfterPage(
        {
          ...page,
          records: page.records.flatMap((record) => {
            const parsed = externalRecordSchema.safeParse(record);
            return parsed.success &&
              (!credentialCanary ||
                protectConnectorSourceRecord(
                  safeSourceSnapshot(parsed.data, capabilities),
                  credentialCanary,
                ).issues.length === 0)
              ? [parsed.data]
              : [];
          }),
        },
        run.cursorFrom,
      );
    }
    const records = sourceRecords.map((record) =>
      externalRecordSchema.safeParse(record),
    );
    const identities = new Set<string>();
    for (const record of records) {
      if (!record.success) continue;
      const identity = `${record.data.entityType}:${normalizeIdentity(record.data.externalId)}`;
      if (identities.has(identity))
        throw new ConnectorWorkerFailure("invalid_data");
      identities.add(identity);
    }
    const context = createConnectorSyncPlanContext(
      this.supabase,
      organizationId,
      connectorId,
      connector,
      records.flatMap((record) => (record.success ? [record.data] : [])),
    );
    const planItems: Record<string, unknown>[] = [];
    const conflicts: Record<string, unknown>[] = [];
    let renewedAt = Date.now();
    for (const [index, parsed] of records.entries()) {
      if (Date.now() - renewedAt >= 20_000) {
        await this.renewLease(run);
        renewedAt = Date.now();
      }
      if (!parsed.success) {
        planItems.push({
          externalId: `invalid-record-${index + 1}`,
          entityType: "product",
          proposedAction: "rejected",
          fieldDiffs: {},
          issues: [
            {
              code: "malformed_record",
              message:
                "The provider record does not satisfy the supported source contract.",
              severity: "error",
            },
          ],
          craProductId: null,
          craReleaseId: null,
          expectedVersion: null,
          sourceSnapshot: null,
          errorCategory: "invalid_data",
          errorCode: "malformed_record",
        });
        continue;
      }
      const source = parsed.data;
      const sourceSnapshot = safeSourceSnapshot(source, capabilities);
      const guarded = credentialCanary
        ? protectConnectorSourceRecord(sourceSnapshot, credentialCanary)
        : { record: sourceSnapshot, issues: [] };
      if (guarded.issues.length > 0) {
        planItems.push({
          externalId: `redacted-record-${index + 1}`,
          entityType: source.entityType,
          proposedAction: "rejected",
          fieldDiffs: {},
          issues: [
            {
              code: "invalid_data",
              message:
                "The source record is unsafe to retain. Review the provider field selection.",
              severity: "error",
            },
          ],
          craProductId: null,
          craReleaseId: null,
          expectedVersion: null,
          sourceSnapshot: null,
          errorCategory: "invalid_data",
          errorCode: "invalid_data",
        });
        continue;
      }
      const mapped = applyConnectorFieldMappings(
        guarded.record,
        run.fieldMappingSnapshot,
        capabilities,
      );
      const planned =
        mapped.issues.length > 0
          ? {
              item: {
                externalId: source.externalId,
                entityType: source.entityType,
                proposedAction: "rejected",
                fieldDiffs: {},
                issues: mapped.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  severity: "error" as const,
                })),
                craProductId: null,
                craReleaseId: null,
                expectedVersion: null,
              },
              conflicts: [],
            }
          : await withDeadline(
              planExternalRecord(context, mapped.record),
              AbortSignal.timeout(15_000),
            );
      const { item, conflicts: recordConflicts } = planned;
      const failed = item.issues.some((issue) => issue.severity === "error");
      planItems.push({
        ...item,
        sourceSnapshot,
        errorCategory: failed ? "invalid_data" : null,
        errorCode: failed
          ? item.issues.find((issue) => issue.severity === "error")!.code
          : null,
      });
      for (const conflict of recordConflicts) {
        conflicts.push({
          externalIdentityId: conflict.externalIdentityId,
          planItemExternalId: conflict.planItemExternalId,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          fieldPath: conflict.fieldPath,
          conflictKind: conflict.conflictKind,
          craValue: conflict.craValue,
          craValueSource: conflict.craValueSource,
          craValueObservedAt: conflict.craValueObservedAt,
          externalValue: conflict.externalValue,
          externalValueHash: conflict.externalValueHash,
          externalValueObservedAt: conflict.externalValueObservedAt,
          authorityPolicyId: conflict.authorityPolicyId,
          authorityPolicySnapshot: conflict.authorityPolicySnapshot,
          permittedActions: conflict.permittedActions,
        });
      }
    }

    const fetchContentHash = createHash("sha256")
      .update(JSON.stringify(planItems.map((item) => item.sourceSnapshot)))
      .digest("hex");

    const productPermissions = productPermissionsFor(
      planItems.map((item) => item.proposedAction),
    );
    await this.assertAuthorized(run, productPermissions);
    await this.renewLease(run);

    await this.repository.saveSyncRunPlan({
      p_organization_id: organizationId,
      p_sync_run_id: run.id,
      p_worker_id: this.workerId,
      p_cursor_to: cursorTo,
      p_generation: run.leaseGeneration,
      p_schema_snapshot: capabilities,
      p_fetch_content_hash: fetchContentHash,
      p_plan_items: planItems,
      p_conflicts: conflicts,
    });
  }

  private async renewLease(run: ClaimedSyncRun): Promise<void> {
    if (
      !(await this.repository.renewSyncRunLease(
        run.organizationId,
        run.id,
        this.workerId,
        run.leaseGeneration,
        this.leaseSeconds,
      ))
    ) {
      throw new ConnectorWorkerFailure("stale_preview");
    }
  }

  private async assertEgress(
    config: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.security?.egress)
      await withDeadline(this.security.egress.validate(config), signal);
    else if (config.baseUrl !== undefined)
      throw new Error("Connector endpoint validation unavailable");
  }

  private async assertAuthorized(
    run: ClaimedSyncRun,
    additionalPermissions: readonly PermissionKey[] = [],
  ): Promise<ConnectorHubContext> {
    if (
      !this.security ||
      !run.actorId ||
      run.connectionRevision === null ||
      run.credentialRevision === null ||
      run.permissionVersion === null
    )
      throw new ConnectorWorkerFailure("authorization_changed");
    const authority = await this.security.authorization.authorize(
      run.organizationId,
      run.actorId,
      ["can_create_connectors", "can_view_products", ...additionalPermissions],
    );
    if (
      authority.permissionVersion !== run.permissionVersion ||
      authority.organizationId !== run.organizationId ||
      authority.actorId !== run.actorId
    )
      throw new ConnectorWorkerFailure("authorization_changed");
    const context = await this.security.hub.context(
      run.organizationId,
      run.connectorId,
    );
    if (
      !context.connector.enabled ||
      context.connector.archivedAt !== null ||
      context.connectionRevision !== run.connectionRevision ||
      context.credentialRevision !== run.credentialRevision
    )
      throw new ConnectorWorkerFailure("configuration_changed");
    return context;
  }
}

function productPermissionsFor(actions: readonly unknown[]): PermissionKey[] {
  return [
    ...(actions.includes("create") ? ["can_create_products" as const] : []),
    ...(actions.includes("update") || actions.includes("conflict")
      ? ["can_edit_products" as const]
      : []),
    ...(actions.includes("archive") ? ["can_delete_products" as const] : []),
  ];
}

function safeSourceSnapshot(
  record: ExternalRecord,
  capabilities: ConnectorCapabilities,
): ExternalRecord {
  const approved = new Set(
    capabilities.entities
      .find((entry) => entry.entityType === record.entityType)
      ?.fields.filter((field) => field.supportsPull && !field.sensitive)
      .map((field) => field.vendorFieldPath) ?? [],
  );
  return {
    ...record,
    fields: Object.fromEntries(
      Object.entries(record.fields).filter(([field]) => approved.has(field)),
    ),
  };
}

export function toClaimedSyncRun(value: unknown): ClaimedSyncRun {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connector claim returned an invalid run shape");
  }
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id);
  const organizationId = requiredString(row.organizationId);
  const connectorId = requiredString(row.connectorId);
  const workKind = row.workKind;
  if (workKind !== "dry_run" && workKind !== "commit") {
    throw new Error("Connector claim returned an invalid work kind");
  }
  return {
    id,
    organizationId,
    connectorId,
    workKind,
    cursorFrom: optionalString(row.cursorFrom),
    cursorTo: optionalString(row.cursorTo),
    fetchContentHash: optionalString(row.fetchContentHash),
    correlationId: optionalString(row.correlationId),
    actorId: optionalString(row.actorId),
    commitActorId: optionalString(row.commitActorId),
    connectionRevision: optionalInteger(row.connectionRevision, 1),
    credentialRevision: optionalInteger(row.credentialRevision, 0),
    permissionVersion: optionalInteger(row.permissionVersion, 0),
    leaseGeneration:
      optionalInteger(row.leaseGeneration, 1) ??
      (() => {
        throw new Error("Connector claim generation is unavailable");
      })(),
    fieldMappingSnapshot: connectorFieldMappingsSchema.parse(
      row.fieldMappingSnapshot,
    ),
    fieldMappingRevision:
      optionalInteger(row.fieldMappingRevision, 0) ??
      (() => {
        throw new Error("Connector mapping revision is unavailable");
      })(),
    schemaSnapshot:
      row.schemaSnapshot === null || row.schemaSnapshot === undefined
        ? null
        : connectorCapabilitiesSchema.parse(row.schemaSnapshot),
    replaySourceMode: z
      .enum(["retained", "refetch"])
      .nullable()
      .parse(row.replaySourceMode ?? null),
    replaySourceRecords: z
      .array(z.unknown())
      .max(pullPageSize)
      .parse(row.replaySourceRecords ?? []),
  };
}

function optionalInteger(value: unknown, minimum: number): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new Error("Connector claim returned invalid authorization metadata");
  return value;
}

async function withDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new ConnectorWorkerFailure("timeout");
  let interrupt: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        interrupt = () => reject(new ConnectorWorkerFailure("timeout"));
        signal.addEventListener("abort", interrupt, { once: true });
      }),
    ]);
  } finally {
    if (interrupt) signal.removeEventListener("abort", interrupt);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "Connector claim returned a required field in an invalid shape",
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

/** A terminal provider page still advances to the last durably planned row.
 * `nextCursor === null` means page exhaustion, never "reuse cursorFrom". */
export function cursorAfterPage(
  page: Readonly<{
    records: readonly Readonly<{
      externalUpdatedAt: string;
      externalId: string;
    }>[];
    nextCursor: Readonly<{ token: string }> | null;
  }>,
  cursorFrom: string | null,
): string | null {
  if (page.nextCursor) return page.nextCursor.token;
  const last = page.records.at(-1);
  return last ? `${last.externalUpdatedAt}|${last.externalId}` : cursorFrom;
}

/** The durable cursor is a composite adapter token. Restore its watermark
 * separately so same-timestamp records are ordered by the token suffix rather
 * than accidentally comparing timestamps with `timestamp|externalId`. */
export function cursorInputFor(
  cursor: string | null,
): Readonly<{ token: string; watermark: string }> | null {
  if (cursor === null) return null;
  const delimiter = cursor.lastIndexOf("|");
  return {
    token: cursor,
    watermark: delimiter > 0 ? cursor.slice(0, delimiter) : cursor,
  };
}
