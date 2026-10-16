import { createHash } from "node:crypto";
import type { ConnectorType } from "../application/connector-port";
import type { SyncPlanContext } from "../application/sync-plan-builder";
import type { FieldAuthorityPolicy } from "../application/field-authority-policy";
import { normalizeIdentity } from "../application/identity-matching-policy";
import type { SupabaseService } from "../../supabase/supabase.service";

type PersistedConnector = Readonly<{
  connectorType: ConnectorType;
  connectionConfig: Readonly<Record<string, unknown>>;
  hasSecret: boolean;
}>;
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createConnectorSyncPlanContext(
  supabase: SupabaseService,
  organizationId: string,
  connectorId: string,
  connector: PersistedConnector,
  pageRecords: readonly Readonly<{
    entityType: "product" | "release";
    externalId: string;
    changeKind: "upsert" | "tombstone";
  }>[],
): SyncPlanContext {
  const admin = () => supabase.admin();
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
      const { data, error } = await admin()
        .from("product_external_identities")
        .select("id, cra_product_id, cra_release_id")
        .eq("organization_id", organizationId)
        .eq("connector_id", connectorId)
        .eq("entity_type", entityType)
        .eq("external_id_normalized", externalIdNormalized)
        .is("superseded_at", null)
        .is("unlinked_at", null)
        .maybeSingle();
      if (error) throw new Error("connector_identity_lookup_failed");
      if (!data) return null;
      return {
        id: data.id,
        craProductId: data.cra_product_id,
        craReleaseId: data.cra_release_id,
      };
    },
    findProductCandidatesByCode: async (normalizedCode) => {
      const { data, error } = await admin()
        .from("products")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("internal_code_normalized", normalizedCode);
      if (error) throw new Error("connector_product_candidates_lookup_failed");
      const rows = (data ?? []) as readonly { id: string }[];
      return Promise.all(
        rows.map(async (row) => {
          const { count, error: countError } = await admin()
            .from("product_external_identities")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("cra_product_id", row.id)
            .neq("connector_id", connectorId)
            .is("superseded_at", null)
            .is("unlinked_at", null);
          if (countError)
            throw new Error("connector_product_mapping_lookup_failed");
          return {
            productId: row.id,
            hasOtherActiveMapping: (count ?? 0) > 0,
          };
        }),
      );
    },
    findReleaseCandidatesByVersion: async (productId, normalizedVersion) => {
      const { data, error } = await admin()
        .from("product_releases")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("product_id", productId)
        .eq("release_version_normalized", normalizedVersion);
      if (error) throw new Error("connector_release_candidates_lookup_failed");
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
      const parentProductIds = unique(rows.map((row) => row.source_product_id));
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
      const { data, error } = await admin()
        .from("products")
        .select("name, internal_code, product_type, description, version")
        .eq("organization_id", organizationId)
        .eq("id", productId)
        .maybeSingle();
      if (error) throw new Error("connector_product_fields_lookup_failed");
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
      const { data, error } = await admin()
        .from("product_releases")
        .select("label, release_version, description, version")
        .eq("organization_id", organizationId)
        .eq("product_id", productId)
        .eq("id", releaseId)
        .maybeSingle();
      if (error) throw new Error("connector_release_fields_lookup_failed");
      if (!data) return null;
      return {
        label: data.label,
        releaseVersion: data.release_version,
        description: data.description,
        version: data.version,
      };
    },
    getFieldAuthorityPolicy: async (entityType, field) => {
      const { data, error } = await admin()
        .from("field_authority_policies")
        .select("id, policy_value, protected, policy_version")
        .eq("organization_id", organizationId)
        .eq("connector_id", connectorId)
        .eq("entity_type", entityType)
        .eq("field_name", field)
        .is("superseded_at", null)
        .maybeSingle();
      if (error) throw new Error("connector_field_policy_lookup_failed");
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
