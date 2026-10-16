import { LicensingError } from "../application/licensing.errors";
import { SupabaseSupplierEvidenceRepository } from "../../supplier-evidence/infrastructure/supabase-supplier-evidence.repository";
import { SupabaseSbomRepository } from "../../sboms/infrastructure/supabase-sbom.repository";
import { SupabaseInvitationRepository } from "../../invitations/infrastructure/supabase-invitation.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { SourceLicenseAdmission } from "./source-license-admission";

describe("source repository admission ordering", () => {
  function fixture() {
    const error = new LicensingError("license_write_denied", 403, "Denied");
    const rpc = jest.fn();
    const supabase = { admin: () => ({ rpc }) } as unknown as SupabaseService;
    const admission = {
      supplier: jest.fn().mockRejectedValue(error),
      invitation: jest.fn().mockRejectedValue(error),
    };
    return { supabase, rpc, admission, error };
  }
  it("denies public evidence reservation before its source transaction", async () => {
    const { supabase, rpc, admission, error } = fixture();
    const repository = new SupabaseSupplierEvidenceRepository(
      supabase,
      admission as unknown as SourceLicenseAdmission,
    );
    await expect(
      repository.reserve({ sessionTokenHash: "a".repeat(64) } as Parameters<
        typeof repository.reserve
      >[0]),
    ).rejects.toBe(error);
    expect(admission.supplier).toHaveBeenCalledWith(
      "supplier_evidence",
      "a".repeat(64),
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("denies public supplier SBOM reservation before its source transaction", async () => {
    const { supabase, rpc, admission, error } = fixture();
    const repository = new SupabaseSbomRepository(
      supabase,
      admission as unknown as SourceLicenseAdmission,
    );
    await expect(
      repository.reserveUpload({ sessionToken: "opaque-session" } as Parameters<
        typeof repository.reserveUpload
      >[0]),
    ).rejects.toBe(error);
    expect(admission.supplier).toHaveBeenCalledWith(
      "supplier_sbom",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("denies new invited seat before membership transaction", async () => {
    const { supabase, rpc, admission, error } = fixture();
    const repository = new SupabaseInvitationRepository(
      supabase,
      admission as unknown as SourceLicenseAdmission,
    );
    await expect(
      repository.acceptAtomic("b".repeat(64), {
        id: "actor",
        email: "member@cra.test",
      }),
    ).rejects.toBe(error);
    expect(admission.invitation).toHaveBeenCalledWith(
      "b".repeat(64),
      "member@cra.test",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
