import { Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type {
  ConnectorConnectionConfig,
  ConnectorPort,
  ConnectorType,
} from "../application/connector-port";
import {
  planExternalRecord,
  type SyncPlanContext,
} from "../application/sync-plan-builder";
import type { FieldAuthorityPolicy } from "../application/field-authority-policy";
import { normalizeIdentity } from "../application/identity-matching-policy";
import { SupabaseConnectorRepository } from "../infrastructure/supabase-connector.repository";
import type { SupabaseService } from "../../supabase/supabase.service";

const maximumClaimsPerCycle = Number(
  process.env.CONNECTOR_SYNC_MAX_CLAIMS_PER_CYCLE ?? 200,
);
const pullPageSize = 200;

type ClaimedSyncRun = Readonly<{
  id: string;
  organizationId: string;
  connectorId: string;
  workKind: "dry_run" | "commit";
  cursorFrom: string | null;
  fetchContentHash: string | null;
  correlationId: string | null;
}>;

type PersistedConnector = Readonly<{
  connectorType: ConnectorType;
  connectionConfig: Readonly<Record<string, unknown>>;
  hasSecret: boolean;
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
    private readonly encryptionKey: string,
    private readonly workerId: string,
    private readonly leaseSeconds = 60,
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
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        error instanceof Error ? "worker_exception" : "unknown",
      );
    }
    return true;
  }

  private async applyCommit(run: ClaimedSyncRun): Promise<void> {
    const organizationId = run.organizationId;
    const actorId = await this.repository.resolveWorkerActor(organizationId);
    if (!actorId) {
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        "no_worker_actor_available",
      );
      return;
    }
    await this.repository.commitSyncRun({
      p_organization_id: organizationId,
      p_sync_run_id: run.id,
      p_actor_user_id: actorId,
      p_fetch_content_hash: run.fetchContentHash,
      p_idempotency_key: randomUUID(),
      p_correlation_id: run.correlationId ?? randomUUID(),
    });
    // commit_sync_run_atomic is fully self-contained (apply + cursor advance +
    // retry/fail bookkeeping all happen inside that one transaction) -- the
    // worker's job here is only to invoke it, never to reinterpret its result.
  }

  private async buildAndSavePlan(run: ClaimedSyncRun): Promise<void> {
    const organizationId = run.organizationId;
    const connectorId = run.connectorId;
    const connector = (await this.repository.getConnector(
      organizationId,
      connectorId,
    )) as PersistedConnector;
    const adapter = this.adapters.get(connector.connectorType);
    if (!adapter) {
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        "unsupported_connector_type",
      );
      return;
    }

    const secretValue = connector.hasSecret
      ? await this.repository.resolveConnectorSecret(
          organizationId,
          connectorId,
          this.encryptionKey,
        )
      : null;
    const config: ConnectorConnectionConfig = {
      connectorType: connector.connectorType,
      ...connector.connectionConfig,
      secretReference: {
        provider: "reference_fixture",
        reference: secretValue ?? "",
      },
    };

    const connectionResult = await adapter.testConnection(config);
    if (connectionResult.outcome === "failure") {
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        connectionResult.errorCode,
      );
      return;
    }

    const cursorFrom = run.cursorFrom;
    const page = await adapter.pull(
      config,
      cursorInputFor(cursorFrom),
      pullPageSize,
    );

    if (page.adapterSignal === "rate_limited") {
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        "rate_limited",
      );
      return;
    }
    if (
      page.adapterSignal === "cursor_expired" ||
      page.adapterSignal === "cursor_invalid"
    ) {
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        page.adapterSignal,
      );
      return;
    }
    if (page.adapterSignal === "unavailable") {
      await this.repository.failSyncRun(
        organizationId,
        run.id,
        this.workerId,
        "provider_unavailable",
      );
      return;
    }

    const context = this.buildPlanContext(
      organizationId,
      connectorId,
      connector,
      page.records,
    );
    const planItems: Record<string, unknown>[] = [];
    const conflicts: Record<string, unknown>[] = [];
    for (const record of page.records) {
      const { item, conflicts: recordConflicts } = await planExternalRecord(
        context,
        record,
      );
      planItems.push({
        externalId: item.externalId,
        entityType: item.entityType,
        proposedAction: item.proposedAction,
        fieldDiffs: item.fieldDiffs,
        issues: item.issues,
        craProductId: item.craProductId,
        craReleaseId: item.craReleaseId,
        expectedVersion: item.expectedVersion,
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
      .update(JSON.stringify(page.records))
      .digest("hex");

    await this.repository.saveSyncRunPlan({
      p_organization_id: organizationId,
      p_sync_run_id: run.id,
      p_worker_id: this.workerId,
      p_cursor_to: cursorAfterPage(page, cursorFrom),
      p_fetch_content_hash: fetchContentHash,
      p_plan_items: planItems,
      p_conflicts: conflicts,
    });
  }

  private buildPlanContext(
    organizationId: string,
    connectorId: string,
    connector: PersistedConnector,
    pageRecords: readonly Readonly<{
      entityType: "product" | "release";
      externalId: string;
      changeKind: "upsert" | "tombstone";
    }>[],
  ): SyncPlanContext {
    const admin = () => this.supabase.admin();
    const config = connector.connectionConfig;
    const defaultOwnerBinding =
      typeof config.defaultOwnerBinding === "object" &&
      config.defaultOwnerBinding !== null
        ? (config.defaultOwnerBinding as {
            responsibleOwnerId: string;
            legalEntityId: string;
          })
        : null;
    const productRecordCounts = new Map<string, number>();
    for (const record of pageRecords) {
      if (record.entityType !== "product" || record.changeKind !== "upsert") {
        continue;
      }
      const normalized = normalizeIdentity(record.externalId);
      productRecordCounts.set(
        normalized,
        (productRecordCounts.get(normalized) ?? 0) + 1,
      );
    }

    return {
      organizationId,
      connectorId,
      defaultOwnerBinding,
      findActiveMapping: async (entityType, externalIdNormalized) => {
        const { data } = await admin()
          .from("product_external_identities")
          .select("id, cra_product_id, cra_release_id")
          .eq("organization_id", organizationId)
          .eq("connector_id", connectorId)
          .eq("entity_type", entityType)
          .eq("external_id_normalized", externalIdNormalized)
          .is("superseded_at", null)
          .is("unlinked_at", null)
          .maybeSingle();
        if (!data) return null;
        return {
          id: data.id,
          craProductId: data.cra_product_id,
          craReleaseId: data.cra_release_id,
        };
      },
      findProductCandidatesByCode: async (normalizedCode) => {
        const { data } = await admin()
          .from("products")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("internal_code_normalized", normalizedCode);
        const rows = (data ?? []) as readonly { id: string }[];
        return Promise.all(
          rows.map(async (row) => {
            const { count } = await admin()
              .from("product_external_identities")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("cra_product_id", row.id)
              .neq("connector_id", connectorId)
              .is("superseded_at", null)
              .is("unlinked_at", null);
            return {
              productId: row.id,
              hasOtherActiveMapping: (count ?? 0) > 0,
            };
          }),
        );
      },
      findReleaseCandidatesByVersion: async (productId, normalizedVersion) => {
        const { data } = await admin()
          .from("product_releases")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("product_id", productId)
          .eq("release_version_normalized", normalizedVersion);
        const rows = (data ?? []) as readonly { id: string }[];
        return rows.map((row) => ({
          releaseId: row.id,
          hasOtherActiveMapping: false,
        }));
      },
      getActiveProductMappingsForExternalParent: async (
        parentExternalIdNormalized,
      ) => {
        const { data, error } = await admin()
          .from("product_external_identities")
          .select("id, cra_product_id")
          .eq("organization_id", organizationId)
          .eq("connector_id", connectorId)
          .eq("entity_type", "product")
          .eq("external_id_normalized", parentExternalIdNormalized)
          .is("superseded_at", null)
          .is("unlinked_at", null);
        if (error) throw new Error("connector_parent_mapping_lookup_failed");
        return (data ?? []).map((row) => ({
          identityId: row.id,
          craProductId: row.cra_product_id,
        }));
      },
      getConnectorOwnedParent: async (childProductId) => {
        const { data, error } = await admin()
          .from("product_relationships")
          .select("source_product_id")
          .eq("organization_id", organizationId)
          .eq("relationship_type", "embedded")
          .eq("target_product_id", childProductId)
          .eq("source", "connector_sync")
          .like("provenance", `connector-sync:v1:${connectorId}:%`)
          .is("ended_at", null)
          .limit(2);
        if (error) throw new Error("connector_owned_parent_lookup_failed");

        const rows = (data ?? []) as readonly {
          source_product_id: string;
        }[];
        const parentProductIds = unique(
          rows.map((row) => row.source_product_id),
        );
        if (parentProductIds.length === 0) return { outcome: "none" };
        if (parentProductIds.length === 1) {
          return {
            outcome: "one",
            parentProductId: parentProductIds[0]!,
          };
        }
        return { outcome: "ambiguous", parentProductIds };
      },
      wouldCreateEmbeddedComponentCycle: async (
        parentProductId,
        childProductId,
      ) => {
        const { data: settings, error: settingsError } = await admin()
          .from("organization_settings")
          .select("product_relationship_graph_version")
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (settingsError || !settings) {
          throw new Error("connector_relationship_graph_lookup_failed");
        }
        const { data: preview, error: previewError } = await admin().rpc(
          "m2_component_link_preview",
          {
            p_organization_id: organizationId,
            p_parent_product_id: parentProductId,
            p_component_product_id: childProductId,
            p_effective_at: new Date().toISOString(),
            p_graph_version: settings.product_relationship_graph_version,
            p_excluding_relationship_id: undefined,
          },
        );
        if (previewError || !preview || typeof preview !== "object") {
          throw new Error("connector_relationship_graph_preview_failed");
        }
        return (preview as { outcome?: unknown }).outcome !== "allowed";
      },
      isProductExternalIdPlanned: (externalIdNormalized) =>
        productRecordCounts.get(externalIdNormalized) === 1,
      getProductFields: async (productId) => {
        const { data } = await admin()
          .from("products")
          .select("name, internal_code, product_type, description, version")
          .eq("organization_id", organizationId)
          .eq("id", productId)
          .maybeSingle();
        if (!data) return null;
        return {
          name: data.name,
          internalCode: data.internal_code,
          productType: data.product_type,
          description: data.description,
          version: data.version,
        };
      },
      getReleaseFields: async (productId, releaseId) => {
        const { data } = await admin()
          .from("product_releases")
          .select("label, release_version, description, version")
          .eq("organization_id", organizationId)
          .eq("product_id", productId)
          .eq("id", releaseId)
          .maybeSingle();
        if (!data) return null;
        return {
          label: data.label,
          releaseVersion: data.release_version,
          description: data.description,
          version: data.version,
        };
      },
      getFieldAuthorityPolicy: async (entityType, field) => {
        const { data } = await admin()
          .from("field_authority_policies")
          .select("id, policy_value, protected, policy_version")
          .eq("organization_id", organizationId)
          .eq("connector_id", connectorId)
          .eq("entity_type", entityType)
          .eq("field_name", field)
          .is("superseded_at", null)
          .maybeSingle();
        if (!data) return null;
        return {
          id: data.id,
          policyValue: data.policy_value as FieldAuthorityPolicy["policyValue"],
          protected: data.protected,
          policyVersion: data.policy_version,
        };
      },
      hashValue: (value) =>
        createHash("sha256")
          .update(JSON.stringify(value ?? null))
          .digest("hex"),
      nowIso: () => new Date().toISOString(),
    };
  }
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
    fetchContentHash: optionalString(row.fetchContentHash),
    correlationId: optionalString(row.correlationId),
  };
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
