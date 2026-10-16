import { LicensingError } from "../application/licensing.errors";
import {
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import { LicensingService } from "../application/licensing.service";

/** Public bearer scope is resolved by its source authority before verification refresh. */
@Injectable()
export class SourceLicenseAdmission {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly licensing: LicensingService,
  ) {}
  async supplier(
    kind: "supplier_evidence" | "supplier_sbom",
    sessionTokenHash: string,
  ): Promise<void> {
    const client = this.supabase.admin() as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await client.rpc(
      "m15_01_supplier_source_organization",
      { p_kind: kind, p_session_token_hash: sessionTokenHash },
    );
    if (error)
      throw new ServiceUnavailableException(
        "Source licence authority unavailable",
      );
    const organizationId = z.uuid().nullable().parse(data);
    if (!organizationId)
      throw new ForbiddenException("Source session unavailable");
    await this.licensing.assertOperation(organizationId, "", {
      kind: "customer",
      mutation: true,
      capability: "suppliers",
    });
    if (kind === "supplier_sbom")
      await this.licensing.assertOperation(organizationId, "", {
        kind: "customer",
        mutation: true,
        capability: "sboms",
      });
  }
  async invitation(tokenHash: string, email: string): Promise<void> {
    // Pending matching invitations alone need new-seat admission. Invalid,
    // expired and already accepted tokens retain the original source outcome.
    const { data, error } = await this.supabase
      .admin()
      .from("invitations")
      .select("organization_id,email")
      .eq("token_hash", tokenHash)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error)
      throw new ServiceUnavailableException(
        "Invitation licence authority unavailable",
      );
    if (!data || data.email.toLowerCase() !== email.toLowerCase()) return;
    await this.licensing.assertOperation(data.organization_id, "", {
      kind: "customer",
      mutation: true,
      capability: "administration",
    });
  }
  async reporting(organizationId: string): Promise<void> {
    try {
      await this.licensing.getWorkerPolicy(organizationId);
    } catch (error) {
      // Source SQL owns the protected real-obligation exception, including absent
      // provisioning and trust failure. Every new/elective write still fails there.
      if (!(error instanceof LicensingError)) throw error;
    }
  }
  async ci(organizationId: string): Promise<void> {
    await this.licensing.assertOperation(organizationId, "", {
      kind: "customer",
      mutation: true,
      capability: "connectors",
    });
    await this.licensing.assertOperation(organizationId, "", {
      kind: "customer",
      mutation: true,
      capability: "sboms",
    });
  }
}
