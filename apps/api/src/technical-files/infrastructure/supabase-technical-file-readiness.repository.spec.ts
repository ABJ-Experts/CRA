import { TechnicalFileReadinessConflictError } from "../application/technical-file-readiness.port";
import { SupabaseTechnicalFileReadinessRepository } from "./supabase-technical-file-readiness.repository";

describe("SupabaseTechnicalFileReadinessRepository", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";
  const sourceId = "00000000-0000-4000-8000-000000000004";

  it("passes verified tenant scope and revision fingerprint to the material-change RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { outcome: "conflict", result: { currentVersion: 4 } },
      error: null,
    });
    const repository = new SupabaseTechnicalFileReadinessRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.signalMaterialChange(organizationId, {
        actorId,
        productId,
        sectionKey: "standards_common_specifications",
        sourceId,
        expectedVersion: 2,
        reason: "standard_edition_changed",
        currentObservedRevision: "2025",
        currentFingerprint: "edition-2025",
        idempotencyKey: "source-change-1",
      }),
    ).rejects.toBeInstanceOf(TechnicalFileReadinessConflictError);

    expect(rpc).toHaveBeenCalledWith(
      "mark_technical_file_section_source_material_change_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_source_id: sourceId,
        p_current_observed_revision: "2025",
        p_current_fingerprint: "edition-2025",
      }),
    );
  });

  it("preserves an intentional missing technical file", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { outcome: "not_found", result: null },
      error: null,
    });
    const repository = new SupabaseTechnicalFileReadinessRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.get(organizationId, { actorId, productId }),
    ).resolves.toBeNull();
  });
});
