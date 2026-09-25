import { SupabaseControlRepository } from "./supabase-control.repository";
import {
  ControlBlockedError,
  ControlConflictError,
  ControlForbiddenError,
  ControlInvalidRequestError,
  ControlNotFoundError,
} from "../application/control-use-cases";

describe("SupabaseControlRepository command boundary", () => {
  const rpc = jest.fn();
  const repository = new SupabaseControlRepository({
    admin: () => ({ rpc }),
  } as never);
  const input = {
    actorId: "actor-a",
    operation: "create_control" as const,
    payload: {
      title: "Secure updates",
      description: "Documented updates",
      ownerUserId: "owner-a",
      implementationStatus: "not_started",
    },
    expectedRevision: null,
    idempotencyKey: "2f564a90-a9ef-46e9-afd8-b743866860ff",
  };

  beforeEach(() => rpc.mockReset());

  it("passes verified organization and actor to the atomic SQL command", async () => {
    const result = {
      controlId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "created", result }],
      error: null,
    });
    await expect(repository.command("org-a", input)).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledWith("m10_control_command", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_operation: "create_control",
      p_payload: input.payload,
      p_expected_revision: null,
      p_idempotency_key: input.idempotencyKey,
    });
  });

  it.each([
    ["conflict", ControlConflictError],
    ["forbidden", ControlForbiddenError],
    ["invalid_request", ControlInvalidRequestError],
    ["blocked", ControlBlockedError],
    ["not_found", ControlNotFoundError],
  ])(
    "maps %s without returning untrusted SQL result",
    async (outcome, errorType) => {
      rpc.mockResolvedValue({ data: [{ outcome, result: null }], error: null });
      await expect(repository.command("org-a", input)).rejects.toBeInstanceOf(
        errorType,
      );
    },
  );

  it("accepts a durable replay with the original command result", async () => {
    const result = {
      controlId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "unchanged", result }],
      error: null,
    });
    await expect(repository.command("org-a", input)).resolves.toEqual(result);
  });

  it("rejects unknown outcomes and provider errors", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "unexpected", result: null }],
      error: null,
    });
    await expect(repository.command("org-a", input)).rejects.toMatchObject({
      status: 503,
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await expect(repository.command("org-a", input)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("sends applicability approval to the atomic scoped RPC", async () => {
    const result = {
      approvedNonApplicable: true,
      reason: "No radio",
      revision: 1,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result }],
      error: null,
    });
    await expect(
      repository.setApplicability("org-a", {
        actorId: "actor-a",
        productId: "product-a",
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        requirementKey: "annex-i-i-1",
        state: "not_applicable",
        reason: "No radio",
        expectedRevision: 0,
        idempotencyKey: input.idempotencyKey,
      }),
    ).resolves.toEqual({
      state: "not_applicable",
      reason: "No radio",
      revision: 1,
    });
    expect(rpc).toHaveBeenCalledWith("m10_set_framework_applicability", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_product_id: "product-a",
      p_pack_key: "cra",
      p_version_key: "oj-2024-11-20",
      p_requirement_key: "annex-i-i-1",
      p_approved: true,
      p_reason: "No radio",
      p_expected_revision: 0,
      p_idempotency_key: input.idempotencyKey,
    });
  });
});

describe("SupabaseControlRepository scoped reads", () => {
  const actorId = "00000000-0000-4000-8000-000000000001";
  const orgId = "00000000-0000-4000-8000-000000000002";
  const ownerId = "00000000-0000-4000-8000-000000000003";
  const controlId = "00000000-0000-4000-8000-000000000004";
  const productId = "00000000-0000-4000-8000-000000000005";
  const evidenceId = "00000000-0000-4000-8000-000000000006";
  const documentId = "00000000-0000-4000-8000-000000000007";
  const linkId = "00000000-0000-4000-8000-000000000008";
  const mappingId = "00000000-0000-4000-8000-000000000009";
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    organization_members: [{ user_id: actorId, organization_id: orgId }],
    users: [{ id: actorId, is_active: true }],
    organizations: [{ id: orgId, is_active: true }],
    framework_controls: [
      {
        organization_id: orgId,
        id: controlId,
        title: "Secure update process",
        description: "Review updates",
        owner_user_id: ownerId,
        implementation_status: "in_progress",
        revision: 2,
        archived_at: null,
        created_at: "2026-09-24T00:00:00Z",
        updated_at: "2026-09-24T00:00:00Z",
      },
    ],
    products: [{ id: productId, organization_id: orgId, archived_at: null }],
    evidence_document_versions: [
      {
        id: evidenceId,
        organization_id: orgId,
        document_id: documentId,
        title: "Test report",
        version_number: 2,
        processing_state: "clean",
        validity_starts_on: null,
        validity_ends_on: null,
      },
    ],
    evidence_documents: [
      { id: documentId, organization_id: orgId, lifecycle_state: "active" },
    ],
    evidence_document_deletion_intents: [],
    framework_control_evidence_links: [
      {
        id: linkId,
        organization_id: orgId,
        control_id: controlId,
        evidence_version_id: evidenceId,
        product_id: productId,
        source_control_revision: 2,
        ended_at: null,
        created_at: "2026-09-24T00:00:00Z",
      },
    ],
    framework_control_requirement_mappings: [
      {
        id: mappingId,
        organization_id: orgId,
        control_id: controlId,
        pack_key: "cra",
        version_key: "oj-2024-11-20",
        requirement_key: "annex-i-i-1",
        rationale: "Applies to this product",
        source_control_revision: 2,
        ended_at: null,
        created_at: "2026-09-24T00:00:00Z",
      },
    ],
    framework_control_mapping_products: [
      {
        organization_id: orgId,
        mapping_id: mappingId,
        product_id: productId,
      },
    ],
    framework_requirements: [
      {
        pack_key: "cra",
        version_key: "oj-2024-11-20",
        requirement_key: "annex-i-i-1",
        identifier: "Annex I Part I 1",
        heading: "Security properties",
        text: "Products shall be designed securely.",
        parent_requirement_key: null,
      },
    ],
    framework_pack_versions: [
      { pack_key: "cra", version_key: "oj-2024-11-20" },
    ],
    framework_coverage_scopes: [
      {
        organization_id: orgId,
        product_id: productId,
        pack_key: "cra",
        version_key: "oj-2024-11-20",
        status: "current",
        source_revision: 1,
        computed_revision: 1,
        updated_at: "2026-09-24T00:00:00Z",
      },
    ],
    framework_coverage_rows: [
      {
        organization_id: orgId,
        product_id: productId,
        pack_key: "cra",
        version_key: "oj-2024-11-20",
        requirement_key: "annex-i-i-1",
        status: "unimplemented",
        computed_revision: 1,
      },
    ],
    framework_requirement_applicability: [],
  };

  function table(name: string) {
    let selected = rows[name] ?? [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push({ table: name, column, value });
        selected = selected.filter((row) => row[column] === value);
        return query;
      },
      is: (column: string, value: unknown) => {
        selected = selected.filter((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        selected = selected.filter((row) => values.includes(row[column]));
        return query;
      },
      order: () => query,
      range: () => query,
      limit: () => query,
      or: () => query,
      maybeSingle: () =>
        Promise.resolve({ data: selected[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: selected, error: null }),
    };
    return query;
  }

  const repository = new SupabaseControlRepository({
    admin: () => ({
      from: table,
      rpc: (name: string) =>
        Promise.resolve({
          data:
            name === "m10_coverage_summary"
              ? {
                  totalRequirements: 1,
                  applicableRequirements: 1,
                  excludedRequirements: 0,
                  evidenceBackedRequirements: 0,
                  gapRequirements: 1,
                }
              : [
                  {
                    status: "current",
                    source_revision: 1,
                    computed_revision: 1,
                  },
                ],
          error: null,
        }),
    }),
  } as never);

  beforeEach(() => {
    filters.length = 0;
  });

  it("lists only selected-organization controls and makes an inactive owner visible", async () => {
    const result = await repository.list(orgId, {
      actorId,
      limit: 50,
      includeArchived: false,
    });
    expect(result.controls).toHaveLength(1);
    expect(result.controls[0]?.ownerActive).toBe(false);
    expect(filters).toContainEqual({
      table: "framework_controls",
      column: "organization_id",
      value: orgId,
    });
    expect(result.nextCursor).toBeNull();
  });

  it("rejects a tenant substitution before querying controls", async () => {
    await expect(
      repository.list("00000000-0000-4000-8000-000000000099", {
        actorId,
        limit: 50,
        includeArchived: false,
      }),
    ).rejects.toBeInstanceOf(ControlForbiddenError);
    expect(
      filters.some((filter) => filter.table === "framework_controls"),
    ).toBe(false);
  });

  it("shows exact evidence versions and explicit mapping products to authorized viewers", async () => {
    const result = await repository.detail(orgId, {
      actorId,
      controlId,
      canViewEvidence: true,
      canViewProducts: true,
    });
    expect(result?.evidenceLinks[0]).toMatchObject({
      evidenceVersionId: evidenceId,
      evidenceVersionNumber: 2,
      availability: "available",
      productId,
    });
    expect(result?.mappings[0]).toMatchObject({
      packKey: "cra",
      versionKey: "oj-2024-11-20",
      requirementKey: "annex-i-i-1",
      productIds: [productId],
      productsRestricted: false,
    });
  });

  it("redacts evidence and product scope from framework-only viewers", async () => {
    const result = await repository.detail(orgId, {
      actorId,
      controlId,
      canViewEvidence: false,
      canViewProducts: false,
    });
    expect(result?.evidenceRestricted).toBe(true);
    expect(result?.evidenceLinks).toEqual([]);
    expect(result?.mappings[0]?.productIds).toEqual([]);
    expect(result?.mappings[0]?.productsRestricted).toBe(true);
    expect(
      filters.some((filter) => filter.table === "evidence_document_versions"),
    ).toBe(false);
  });

  it("counts only product-applicable active mappings, with evidence separate", async () => {
    const result = await repository.coverage(orgId, {
      actorId,
      packKey: "cra",
      versionKey: "oj-2024-11-20",
      productId,
      limit: 100,
    });
    expect(result?.requirements[0]?.controls).toEqual([
      {
        id: controlId,
        title: "Secure update process",
        status: "in_progress",
        ownerActive: false,
        evidencePresent: true,
        evidenceAvailability: "available",
      },
    ]);
    expect(result?.calculation.status).toBe("current");
    expect(result?.summary).toEqual({
      totalRequirements: 1,
      applicableRequirements: 1,
      excludedRequirements: 0,
      evidenceBackedRequirements: 0,
      gapRequirements: 1,
    });
    expect(result?.requirements[0]?.coverageState).toBe("unimplemented");
    expect(result?.requirements[0]?.remediation).toEqual({
      kind: "implement_control",
      controlId,
    });
  });

  it("suppresses positive coverage when the source projection is stale", async () => {
    const scopes = rows.framework_coverage_scopes!;
    const original = scopes[0]!.status;
    scopes[0]!.status = "pending";
    try {
      const result = await repository.coverage(orgId, {
        actorId,
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        productId,
        limit: 100,
      });
      expect(result?.calculation.status).toBe("stale");
      expect(result?.summary).toBeNull();
      expect(result?.requirements[0]?.coverageState).toBe("stale");
    } finally {
      scopes[0]!.status = original;
    }
  });

  it("points a future-evidence gap at an implemented control without treating it as present", async () => {
    const control = rows.framework_controls?.[0];
    const version = rows.evidence_document_versions?.[0];
    const projection = rows.framework_coverage_rows?.[0];
    if (!control || !version || !projection) throw new Error("Missing fixture");
    const originalStatus = control.implementation_status;
    const originalStart = version.validity_starts_on;
    const originalProjection = projection.status;
    control.implementation_status = "implemented";
    version.validity_starts_on = "2099-01-01";
    projection.status = "not_yet_valid_evidence";
    try {
      const result = await repository.coverage(orgId, {
        actorId,
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        productId,
        limit: 100,
      });
      expect(result?.requirements[0]?.coverageState).toBe(
        "not_yet_valid_evidence",
      );
      expect(result?.requirements[0]?.remediation).toEqual({
        kind: "replace_evidence",
        controlId,
      });
      expect(result?.requirements[0]?.controls[0]?.evidencePresent).toBe(false);
    } finally {
      control.implementation_status = originalStatus;
      version.validity_starts_on = originalStart;
      projection.status = originalProjection;
    }
  });

  it("keeps gap filter and summary consistent across a bounded page", async () => {
    const result = await repository.coverage(orgId, {
      actorId,
      packKey: "cra",
      versionKey: "oj-2024-11-20",
      productId,
      limit: 1,
      filter: "gaps",
    });
    expect(result?.requirements).toHaveLength(1);
    expect(result?.summary?.gapRequirements).toBe(1);
    const complete = await repository.coverage(orgId, {
      actorId,
      packKey: "cra",
      versionKey: "oj-2024-11-20",
      productId,
      limit: 1,
      filter: "evidence_backed",
    });
    expect(complete?.requirements).toEqual([]);
    expect(complete?.summary?.gapRequirements).toBe(1);
  });

  it("ends bounded coverage pagination after the final page of a large tree", async () => {
    const requirements = rows.framework_requirements!;
    const projections = rows.framework_coverage_rows!;
    const additions = Array.from({ length: 249 }, (_, index) => {
      const requirementKey = `annex-i-i-extra-${index + 1}`;
      return {
        requirement: {
          pack_key: "cra",
          version_key: "oj-2024-11-20",
          requirement_key: requirementKey,
          identifier: `Extra ${index + 1}`,
          heading: null,
          text: "A requirement.",
          parent_requirement_key: null,
          depth: 1,
        },
        projection: {
          organization_id: orgId,
          product_id: productId,
          pack_key: "cra",
          version_key: "oj-2024-11-20",
          requirement_key: requirementKey,
          status: "no_mapping",
          computed_revision: 1,
        },
      };
    });
    requirements.push(...additions.map((row) => row.requirement));
    projections.push(...additions.map((row) => row.projection));
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 3; page += 1) {
        const result = await repository.coverage(orgId, {
          actorId,
          packKey: "cra",
          versionKey: "oj-2024-11-20",
          productId,
          limit: 100,
          cursor,
        });
        expect(result?.requirements).toHaveLength(page === 2 ? 50 : 100);
        expect(result?.nextCursor === null).toBe(page === 2);
        cursor = result?.nextCursor ?? undefined;
      }
    } finally {
      requirements.splice(-additions.length);
      projections.splice(-additions.length);
    }
  });

  it("returns only active owner candidates without emails", async () => {
    const result = await repository.ownerCandidates(orgId, {
      actorId,
      limit: 100,
    });
    expect(result.owners).toEqual([
      { id: actorId, displayName: "Member 00000000" },
    ]);
    expect(filters).toContainEqual({
      table: "organization_members",
      column: "organization_id",
      value: orgId,
    });
  });

  it("rejects malformed list and coverage cursors", async () => {
    await expect(
      repository.list(orgId, {
        actorId,
        limit: 50,
        includeArchived: false,
        cursor: "not-base64",
      }),
    ).rejects.toBeInstanceOf(ControlInvalidRequestError);
    await expect(
      repository.coverage(orgId, {
        actorId,
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        productId,
        limit: 100,
        cursor: "not-base64",
      }),
    ).rejects.toBeInstanceOf(ControlInvalidRequestError);
  });

  it("marks quarantined, future and archived-product evidence unavailable", async () => {
    const version = rows.evidence_document_versions?.[0];
    const product = rows.products?.[0];
    if (!version || !product) throw new Error("Missing fixture");
    version.processing_state = "quarantined";
    try {
      const quarantined = await repository.detail(orgId, {
        actorId,
        controlId,
        canViewEvidence: true,
        canViewProducts: true,
      });
      expect(quarantined?.evidenceLinks[0]?.availability).toBe("quarantined");
      version.processing_state = "clean";
      version.validity_starts_on = "2099-01-01";
      const future = await repository.detail(orgId, {
        actorId,
        controlId,
        canViewEvidence: true,
        canViewProducts: true,
      });
      expect(future?.evidenceLinks[0]?.availability).toBe("unavailable");
      version.validity_starts_on = null;
      product.archived_at = "2026-09-24T00:00:00Z";
      const archived = await repository.detail(orgId, {
        actorId,
        controlId,
        canViewEvidence: true,
        canViewProducts: true,
      });
      expect(archived?.evidenceLinks[0]?.availability).toBe("unavailable");
    } finally {
      version.processing_state = "clean";
      version.validity_starts_on = null;
      product.archived_at = null;
    }
  });

  it("does not present evidence pending deletion as available or present", async () => {
    const intents = rows.evidence_document_deletion_intents!;
    intents.push({
      organization_id: orgId,
      document_id: documentId,
      state: "queued",
    });
    try {
      const detail = await repository.detail(orgId, {
        actorId,
        controlId,
        canViewEvidence: true,
        canViewProducts: true,
      });
      expect(detail?.evidenceLinks[0]?.availability).toBe("unavailable");
      const coverage = await repository.coverage(orgId, {
        actorId,
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        productId,
        limit: 100,
      });
      expect(coverage?.requirements[0]?.controls[0]?.evidencePresent).toBe(
        false,
      );
      expect(filters).toContainEqual({
        table: "evidence_document_deletion_intents",
        column: "organization_id",
        value: orgId,
      });
    } finally {
      intents.pop();
    }
  });

  it("does not treat a cancelled deletion request as active", async () => {
    const intents = rows.evidence_document_deletion_intents!;
    intents.push({
      organization_id: orgId,
      document_id: documentId,
      state: "cancelled",
    });
    try {
      const detail = await repository.detail(orgId, {
        actorId,
        controlId,
        canViewEvidence: true,
        canViewProducts: true,
      });
      expect(detail?.evidenceLinks[0]?.availability).toBe("available");
    } finally {
      intents.pop();
    }
  });

  it("returns empty bounded views without querying unrelated rows", async () => {
    const controls = rows.framework_controls!;
    const links = rows.framework_control_evidence_links!;
    const mappings = rows.framework_control_requirement_mappings!;
    const requirements = rows.framework_requirements!;
    rows.framework_controls = [];
    rows.framework_control_evidence_links = [];
    rows.framework_control_requirement_mappings = [];
    rows.framework_requirements = [];
    try {
      const list = await repository.list(orgId, {
        actorId,
        limit: 50,
        includeArchived: false,
      });
      expect(list.controls).toEqual([]);
      const coverage = await repository.coverage(orgId, {
        actorId,
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        productId,
        limit: 100,
      });
      expect(coverage?.requirements).toEqual([]);
      const detail = await repository.detail(orgId, {
        actorId,
        controlId,
        canViewEvidence: true,
        canViewProducts: true,
      });
      expect(detail).toBeNull();
    } finally {
      rows.framework_controls = controls;
      rows.framework_control_evidence_links = links;
      rows.framework_control_requirement_mappings = mappings;
      rows.framework_requirements = requirements;
    }
  });

  it("distinguishes a foreign or archived product from an unknown pack", async () => {
    await expect(
      repository.coverage(orgId, {
        actorId,
        packKey: "cra",
        versionKey: "oj-2024-11-20",
        productId: "00000000-0000-4000-8000-000000000099",
        limit: 100,
      }),
    ).rejects.toBeInstanceOf(ControlForbiddenError);
    const unknownPack = await repository.coverage(orgId, {
      actorId,
      packKey: "unknown",
      versionKey: "2024",
      productId,
      limit: 100,
    });
    expect(unknownPack).toBeNull();
  });

  it("paginates controls with a validated keyset cursor", async () => {
    const second = {
      ...rows.framework_controls?.[0],
      id: "00000000-0000-4000-8000-000000000010",
      updated_at: "2026-09-23T00:00:00Z",
    };
    rows.framework_controls?.push(second);
    try {
      const page = await repository.list(orgId, {
        actorId,
        limit: 1,
        includeArchived: true,
      });
      expect(page.nextCursor).toBeTruthy();
      await expect(
        repository.list(orgId, {
          actorId,
          limit: 1,
          includeArchived: true,
          cursor: page.nextCursor ?? undefined,
        }),
      ).resolves.toHaveProperty("controls");
    } finally {
      rows.framework_controls?.pop();
    }
  });
});
