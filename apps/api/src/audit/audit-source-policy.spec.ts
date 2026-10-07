import {
  resolveEffectivePermissions,
  type PermissionSet,
} from "@repo/contracts/permissions";

import { buildAuditSourcePolicy } from "./audit-source-policy";

const filters = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-01-02T00:00:00.000Z",
};

describe("audit source policy", () => {
  it("omits unknown requested entity types before rows can be read", () => {
    const policy = buildAuditSourcePolicy(
      { can_view_audit: true },
      {
        ...filters,
        resourceType: "operator_secret",
      },
    );

    expect(policy.allowedEntityTypes).toEqual([]);
    expect(policy.requestedEntityType).toBe("operator_secret");
  });

  it("uses the resolved permission model so custom export implies audit view", () => {
    const permissions = resolveEffectivePermissions({
      baseRole: "viewer",
      customRoles: [
        {
          id: "4f7c2e5b-0c3b-4ae3-9a2c-5e6d7f8a9b0c",
          name: "Audit exporter",
          base_role: "viewer",
          permissions: { can_export_audit: true },
          is_active: true,
          is_deleted: false,
        },
      ],
    });

    const policy = buildAuditSourcePolicy(permissions, filters);

    expect(policy.allowedEntityTypes).toContain("audit_search");
    expect(policy.allowedEntityTypes).toContain("audit_export");
  });

  it("keeps the organization override as the last word", () => {
    const permissions = resolveEffectivePermissions({
      baseRole: "owner",
      baseRoleOverrides: { can_view_technical_files: false },
    });

    const policy = buildAuditSourcePolicy(permissions, filters);

    expect(policy.allowedEntityTypes).not.toContain("technical_file");
    expect(policy.allowedEntityTypes).not.toContain(
      "technical_file_snapshot_export",
    );
  });

  it("does not grant source visibility from unrelated permissions", () => {
    const permissions: PermissionSet = { can_view_products: true };

    const policy = buildAuditSourcePolicy(permissions, filters);

    expect(policy.allowedEntityTypes).toContain("product");
    expect(policy.allowedEntityTypes).not.toContain("sbom_document");
    expect(policy.allowedEntityTypes).not.toContain("ai_inference_run");
  });
});

it("requires supplier and evidence visibility for supplier AI extraction events", () => {
  const supplierOnly = buildAuditSourcePolicy(
    { can_view_suppliers: true },
    filters,
  );
  const supplierAndEvidence = buildAuditSourcePolicy(
    { can_view_suppliers: true, can_view_evidence: true },
    filters,
  );

  expect(supplierOnly.allowedEntityTypes).not.toContain("ai_inference_run");
  expect(supplierAndEvidence.allowedEntityTypes).toContain("ai_inference_run");
});
