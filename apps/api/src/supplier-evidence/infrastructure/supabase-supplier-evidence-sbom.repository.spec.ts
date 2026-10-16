import { SupabaseSupplierEvidenceSbomRepository } from "./supabase-supplier-evidence-sbom.repository";
import {
  SupplierEvidenceForbiddenError,
  SupplierEvidenceUnavailableError,
} from "../application/supplier-evidence-use-cases";

describe("SupabaseSupplierEvidenceSbomRepository", () => {
  const rpc = jest.fn();
  const repository = new SupabaseSupplierEvidenceSbomRepository({
    admin: () => ({ rpc }),
  } as never);

  beforeEach(() => jest.resetAllMocks());

  it("passes only bearer hashes and the assigned item to grant activation", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "created", result: {} }],
      error: null,
    });
    await expect(
      repository.activate({
        sessionTokenHash: "a".repeat(64),
        checklistItemId: "00000000-0000-4000-8000-000000000021",
        sbomSessionTokenHash: "b".repeat(64),
      }),
    ).resolves.toEqual({ outcome: "created" });
    expect(rpc).toHaveBeenCalledWith(
      "activate_supplier_evidence_sbom_session_atomic",
      {
        p_session_token_hash: "a".repeat(64),
        p_request_item_id: "00000000-0000-4000-8000-000000000021",
        p_sbom_session_token_hash: "b".repeat(64),
      },
    );
  });

  it("fails closed on an unknown database outcome", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "future_status" }],
      error: null,
    });
    await expect(
      repository.activate({
        sessionTokenHash: "a".repeat(64),
        checklistItemId: "00000000-0000-4000-8000-000000000021",
        sbomSessionTokenHash: "b".repeat(64),
      }),
    ).rejects.toThrow();
  });

  it.each(["replayed", "not_found"] as const)(
    "maps the %s grant outcome without exposing a linked request",
    async (outcome) => {
      rpc.mockResolvedValue({ data: [{ outcome, result: {} }], error: null });
      await expect(
        repository.activate({
          sessionTokenHash: "a".repeat(64),
          checklistItemId: "00000000-0000-4000-8000-000000000021",
          sbomSessionTokenHash: "b".repeat(64),
        }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("scopes eligible requests to verified organization, supplier and product", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { requests: [], nextCursor: null } }],
      error: null,
    });
    await expect(
      repository.eligible("00000000-0000-4000-8000-000000000001", {
        actorId: "00000000-0000-4000-8000-000000000002",
        supplierId: "00000000-0000-4000-8000-000000000003",
        productId: "00000000-0000-4000-8000-000000000004",
        limit: 25,
      }),
    ).resolves.toEqual({ requests: [], nextCursor: null });
    expect(rpc).toHaveBeenCalledWith(
      "list_eligible_supplier_evidence_sbom_requests",
      {
        p_organization_id: "00000000-0000-4000-8000-000000000001",
        p_actor_user_id: "00000000-0000-4000-8000-000000000002",
        p_supplier_id: "00000000-0000-4000-8000-000000000003",
        p_product_id: "00000000-0000-4000-8000-000000000004",
        p_limit: 25,
        p_cursor: null,
      },
    );
  });

  it("rejects removed reviewer permission and malformed success payloads", async () => {
    const input = {
      actorId: "00000000-0000-4000-8000-000000000002",
      supplierId: "00000000-0000-4000-8000-000000000003",
      productId: "00000000-0000-4000-8000-000000000004",
      limit: 25,
    };
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "forbidden", result: null }],
      error: null,
    });
    await expect(repository.eligible("org", input)).rejects.toBeInstanceOf(
      SupplierEvidenceForbiddenError,
    );
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", result: { requests: [{ secret: true }] } }],
      error: null,
    });
    await expect(repository.eligible("org", input)).rejects.toThrow();
  });

  it.each([
    { data: null, error: { message: "database offline" } },
    { data: [], error: null },
    { data: [null], error: null },
    { data: [{ result: {} }], error: null },
  ])(
    "fails closed when RPC transport or shape is unavailable",
    async (response) => {
      rpc.mockResolvedValue(response);
      await expect(
        repository.activate({
          sessionTokenHash: "a".repeat(64),
          checklistItemId: "00000000-0000-4000-8000-000000000021",
          sbomSessionTokenHash: "b".repeat(64),
        }),
      ).rejects.toBeInstanceOf(SupplierEvidenceUnavailableError);
    },
  );
});
