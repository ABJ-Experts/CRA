import { CRA_SENTINEL_BRANDING } from "@repo/contracts/organizations";

import {
  BrandingProviderError,
  type BrandingAssetFinalization,
} from "../application/branding-use-cases";
import { SupabaseBrandingRepository } from "./supabase-branding.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";

function draftBranding() {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000004",
    displayName: "Acme",
    palette: Object.freeze({
      primary: "#000000",
      secondary: "#FFFFFF",
    }),
    footerText: "Acme footer",
    contactText: null,
    logoAsset: Object.freeze({
      status: "none" as const,
      asset: null,
    }),
    version: 1,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    createdBy: actorId,
    updatedBy: actorId,
  });
}

function draftWithSelectedLogo() {
  return Object.freeze({
    ...draftBranding(),
    logoAsset: Object.freeze({
      status: "approved" as const,
      asset: Object.freeze({
        assetId,
        width: 128,
        height: 128,
        mimeType: "image/webp" as const,
        sha256: "a".repeat(64),
        altText: "Acme logo",
      }),
    }),
    version: 2,
  });
}

function supabase(
  rpcResult: unknown = [{ outcome: "found", branding: CRA_SENTINEL_BRANDING }],
) {
  const rpc = jest.fn().mockResolvedValue({ data: rpcResult, error: null });
  return {
    admin: () => ({ rpc }),
    rpc,
  };
}

describe("SupabaseBrandingRepository", () => {
  it("uses the coordinated resolved branding RPC without exposing storage locations", async () => {
    const provider = supabase();
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.getResolved(organizationId, actorId),
    ).resolves.toEqual({
      outcome: "found",
      branding: CRA_SENTINEL_BRANDING,
    });
    expect(provider.rpc).toHaveBeenCalledWith("get_organization_branding", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
  });

  it("reserves an asset upload and keeps the private object key prefix adapter-only", async () => {
    const provider = supabase([
      {
        outcome: "reserved",
        asset_id: assetId,
        object_key: "org/asset/",
      },
    ]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.reserveAsset(organizationId, actorId, "Logo"),
    ).resolves.toEqual({
      outcome: "reserved",
      assetId,
      objectKeyPrefix: "org/asset/",
    });
    expect(provider.rpc).toHaveBeenCalledWith(
      "reserve_organization_branding_asset_upload_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_alt_text: "Logo",
      },
    );
  });

  it("resolves an approved logo render object through a server-side RPC only", async () => {
    const provider = supabase([
      {
        outcome: "found",
        object_key: "org/asset/private.webp",
        sha256: "a".repeat(64),
      },
    ]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.getRenderableLogo(organizationId, actorId),
    ).resolves.toEqual({
      outcome: "found",
      objectKey: "org/asset/private.webp",
      sha256: "a".repeat(64),
    });
    expect(provider.rpc).toHaveBeenCalledWith(
      "get_organization_branding_logo_render",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      },
    );
  });

  it("returns not found when no approved logo is renderable", async () => {
    const provider = supabase([{ outcome: "not_found" }]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.getRenderableLogo(organizationId, actorId),
    ).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("uses the draft RPC and preserves a generic inaccessible result", async () => {
    const provider = supabase([{ outcome: "not_found" }]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(repository.getDraft(organizationId, actorId)).resolves.toEqual(
      {
        outcome: "not_found",
      },
    );
    expect(provider.rpc).toHaveBeenCalledWith(
      "get_organization_branding_draft",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      },
    );
  });

  it("returns the selected approved draft logo without exposing its object key", async () => {
    const provider = supabase([
      {
        outcome: "finalized",
        draft: draftWithSelectedLogo(),
      },
    ]);
    const repository = new SupabaseBrandingRepository(provider as never);
    const finalization: BrandingAssetFinalization = {
      contentHash: "a".repeat(64),
      inputBytes: 120,
      width: 128,
      height: 128,
      scannerStatus: "clean",
    };

    await expect(
      repository.finalizeAsset(organizationId, assetId, actorId, finalization),
    ).resolves.toEqual({
      outcome: "finalized",
      draft: draftWithSelectedLogo(),
    });
    expect(provider.rpc).toHaveBeenCalledWith(
      "finalize_organization_branding_asset_upload_atomic",
      {
        p_organization_id: organizationId,
        p_asset_id: assetId,
        p_actor_user_id: actorId,
        p_content_hash: "a".repeat(64),
        p_input_bytes: 120,
        p_width: 128,
        p_height: 128,
        p_scanner_status: "clean",
      },
    );
  });

  it("saves draft footer and contact fields through the coordinated atomic RPC", async () => {
    const provider = supabase([
      {
        outcome: "updated",
        draft: draftBranding(),
        branding: CRA_SENTINEL_BRANDING,
      },
    ]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.saveDraft(organizationId, actorId, {
        expectedVersion: 1,
        displayName: "Acme",
        palette: { primary: "#000000", secondary: "#FFFFFF" },
        footerText: "Acme footer",
        logoAssetId: null,
      }),
    ).resolves.toEqual({
      outcome: "updated",
      draft: draftBranding(),
    });
    expect(provider.rpc).toHaveBeenCalledWith(
      "save_organization_branding_draft_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_expected_version: 1,
        p_display_name: "Acme",
        p_primary_color: "#000000",
        p_secondary_color: "#FFFFFF",
        p_footer_text: "Acme footer",
        p_contact_text: null,
        p_logo_asset_id: null,
      },
    );
  });

  it.each([["not_found"], ["invalid_request"]] as const)(
    "returns a safe %s finalization result",
    async (outcome) => {
      const provider = supabase([{ outcome }]);
      const repository = new SupabaseBrandingRepository(provider as never);

      await expect(
        repository.finalizeAsset(organizationId, assetId, actorId, {
          contentHash: "a".repeat(64),
          inputBytes: 120,
          width: 128,
          height: 128,
          scannerStatus: "clean",
        }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("records asset failure through the organization-scoped RPC", async () => {
    const provider = supabase([{ outcome: "updated" }]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.failAsset(
        organizationId,
        assetId,
        actorId,
        "invalid_image",
        true,
      ),
    ).resolves.toBeUndefined();
    expect(provider.rpc).toHaveBeenCalledWith(
      "fail_organization_branding_asset_upload_atomic",
      {
        p_organization_id: organizationId,
        p_asset_id: assetId,
        p_actor_user_id: actorId,
        p_failure_code: "invalid_image",
        p_quarantined: true,
      },
    );
  });

  it.each([
    ["conflict", { outcome: "conflict", draft: draftBranding() }],
    ["not_found", { outcome: "not_found" }],
    ["invalid_request", { outcome: "invalid_request" }],
  ] as const)("maps safe draft write outcome %s", async (_name, row) => {
    const provider = supabase([row]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.saveDraft(organizationId, actorId, {
        expectedVersion: 1,
        displayName: "Acme",
        palette: { primary: "#000000", secondary: "#FFFFFF" },
        logoAssetId: null,
      }),
    ).resolves.toEqual(
      row.outcome === "conflict"
        ? { outcome: "conflict", draft: draftBranding() }
        : { outcome: row.outcome },
    );
  });

  it.each([
    ["publish", "published"],
    ["publish", "removed"],
    ["remove", "published"],
    ["remove", "removed"],
  ] as const)(
    "maps %s branding %s outcomes with immutable snapshots",
    async (operation, outcome) => {
      const provider = supabase([
        {
          outcome,
          branding: CRA_SENTINEL_BRANDING,
          idempotent: true,
        },
      ]);
      const repository = new SupabaseBrandingRepository(provider as never);
      const input = { expectedVersion: 1, idempotencyKey: assetId };

      await expect(
        operation === "publish"
          ? repository.publish(organizationId, actorId, input, "b".repeat(64))
          : repository.removeLogo(
              organizationId,
              actorId,
              input,
              "b".repeat(64),
            ),
      ).resolves.toEqual({
        outcome,
        branding: CRA_SENTINEL_BRANDING,
        idempotent: true,
      });
    },
  );

  it.each([["conflict"], ["invalid_request"], ["not_found"]] as const)(
    "returns a safe publication %s result",
    async (outcome) => {
      const provider = supabase([{ outcome }]);
      const repository = new SupabaseBrandingRepository(provider as never);

      await expect(
        repository.publish(
          organizationId,
          actorId,
          { expectedVersion: 1, idempotencyKey: assetId },
          "b".repeat(64),
        ),
      ).resolves.toEqual({ outcome });
    },
  );

  it("maps malformed provider branding to a safe provider error", async () => {
    const provider = supabase([
      { outcome: "found", branding: { path: "secret" } },
    ]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.getResolved(organizationId, actorId),
    ).rejects.toEqual(new BrandingProviderError("malformed"));
  });

  it.each([
    ["unexpected outcome", [{ outcome: "foreign" }]],
    [
      "missing required render field",
      [{ outcome: "found", sha256: "a".repeat(64) }],
    ],
    ["non-record row", [null]],
    ["multiple rows", [{ outcome: "not_found" }, { outcome: "not_found" }]],
    ["non-array rows", { outcome: "not_found" }],
  ])("rejects %s as malformed provider data", async (_name, data) => {
    const provider = supabase(data);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.getRenderableLogo(organizationId, actorId),
    ).rejects.toEqual(new BrandingProviderError("malformed"));
  });

  it("maps provider error and transport exceptions to unavailable", async () => {
    const providerError = supabase();
    providerError.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    const transport = {
      admin: () => ({ rpc: jest.fn().mockRejectedValue(new Error("network")) }),
    };

    await expect(
      new SupabaseBrandingRepository(providerError as never).getResolved(
        organizationId,
        actorId,
      ),
    ).rejects.toEqual(new BrandingProviderError("unavailable"));
    await expect(
      new SupabaseBrandingRepository(transport as never).getResolved(
        organizationId,
        actorId,
      ),
    ).rejects.toEqual(new BrandingProviderError("unavailable"));
  });

  it("rejects published outcomes that omit their required idempotency marker", async () => {
    const provider = supabase([
      { outcome: "published", branding: CRA_SENTINEL_BRANDING },
    ]);
    const repository = new SupabaseBrandingRepository(provider as never);

    await expect(
      repository.publish(
        organizationId,
        actorId,
        { expectedVersion: 1, idempotencyKey: assetId },
        "b".repeat(64),
      ),
    ).rejects.toEqual(new BrandingProviderError("malformed"));
  });
});
