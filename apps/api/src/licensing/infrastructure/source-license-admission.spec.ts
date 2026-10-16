import { ForbiddenException } from "@nestjs/common";
import { SourceLicenseAdmission } from "./source-license-admission";
import { LicensingError } from "../application/licensing.errors";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { LicensingService } from "../application/licensing.service";
const org = "00000000-0000-4000-8000-0000000000ca";
describe("source licence admission", () => {
  const setup = () => {
    const rpc = jest.fn().mockResolvedValue({ data: org, error: null });
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      gt: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { organization_id: org, email: "member@cra.test" },
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    const licensing = {
      assertOperation: jest.fn().mockResolvedValue(undefined),
      getWorkerPolicy: jest.fn().mockResolvedValue({}),
    };
    const service = new SourceLicenseAdmission(
      {
        admin: () => ({ rpc, from: () => query }),
      } as unknown as SupabaseService,
      licensing as unknown as LicensingService,
    );
    return { service, rpc, licensing, query };
  };
  it("resolves supplier bearer tenant before refreshing its exact capabilities", async () => {
    const { service, rpc, licensing } = setup();
    await service.supplier("supplier_sbom", "a".repeat(64));
    expect(rpc).toHaveBeenCalledWith("m15_01_supplier_source_organization", {
      p_kind: "supplier_sbom",
      p_session_token_hash: "a".repeat(64),
    });
    expect(licensing.assertOperation).toHaveBeenNthCalledWith(1, org, "", {
      kind: "customer",
      mutation: true,
      capability: "suppliers",
    });
    expect(licensing.assertOperation).toHaveBeenNthCalledWith(2, org, "", {
      kind: "customer",
      mutation: true,
      capability: "sboms",
    });
  });
  it("does not refresh policy for an absent source session", async () => {
    const { service, rpc, licensing } = setup();
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      service.supplier("supplier_evidence", "b".repeat(64)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(licensing.assertOperation).not.toHaveBeenCalled();
  });
  it("refreshes ordinary supplier evidence without an SBOM grant", async () => {
    const { service, licensing } = setup();
    await service.supplier("supplier_evidence", "f".repeat(64));
    expect(licensing.assertOperation).toHaveBeenCalledTimes(1);
  });
  it("fails unavailable before policy refresh when source resolution fails", async () => {
    const { service, licensing, rpc } = setup();
    rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(
      service.supplier("supplier_evidence", "a".repeat(64)),
    ).rejects.toMatchObject({ status: 503 });
    expect(licensing.assertOperation).not.toHaveBeenCalled();
  });
  it("fails unavailable when invitation scope lookup fails", async () => {
    const { service, query, licensing } = setup();
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "08006" },
    });
    await expect(
      service.invitation("a".repeat(64), "member@cra.test"),
    ).rejects.toMatchObject({ status: 503 });
    expect(licensing.assertOperation).not.toHaveBeenCalled();
  });
  it("refreshes both CI capabilities before reserve", async () => {
    const { service, licensing } = setup();
    await service.ci(org);
    expect(licensing.assertOperation).toHaveBeenNthCalledWith(2, org, "", {
      kind: "customer",
      mutation: true,
      capability: "sboms",
    });
  });
  it("refreshes pending invitation tenant before seat admission", async () => {
    const { service, licensing, query } = setup();
    await service.invitation("c".repeat(64), "MEMBER@cra.test");
    expect(query.eq).toHaveBeenCalledWith("token_hash", "c".repeat(64));
    expect(query.eq).toHaveBeenCalledWith("status", "pending");
    expect(licensing.assertOperation).toHaveBeenCalledWith(org, "", {
      kind: "customer",
      mutation: true,
      capability: "administration",
    });
  });
  it("retains source outcomes for invalid and replayed invitations", async () => {
    const { service, licensing, query } = setup();
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await service.invitation("d".repeat(64), "member@cra.test");
    expect(licensing.assertOperation).not.toHaveBeenCalled();
  });
  it("retains email mismatch denial without licence refresh", async () => {
    const { service, licensing } = setup();
    await service.invitation("e".repeat(64), "other@cra.test");
    expect(licensing.assertOperation).not.toHaveBeenCalled();
  });
  it("denies admission before the source write when capability is disabled", async () => {
    const { service, licensing } = setup();
    licensing.assertOperation.mockRejectedValue(
      new LicensingError("license_capability_disabled", 403, "Disabled"),
    );
    await expect(service.ci(org)).rejects.toMatchObject({
      code: "license_capability_disabled",
    });
  });
  it("lets source M6 authority evaluate retained duties on licence configuration failure", async () => {
    const { service, licensing } = setup();
    licensing.getWorkerPolicy.mockRejectedValue(
      new LicensingError("unavailable", 503, "Missing provisioning"),
    );
    await expect(service.reporting(org)).resolves.toBeUndefined();
  });
  it("does not swallow database transport faults", async () => {
    const { service, licensing } = setup();
    licensing.getWorkerPolicy.mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(service.reporting(org)).rejects.toThrow(
      "database unavailable",
    );
  });
});
