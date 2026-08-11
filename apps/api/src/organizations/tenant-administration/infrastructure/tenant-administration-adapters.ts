import { createHash, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  exportAttachmentDownloadResponseSchema,
  mfaRolloutReadinessSchema,
  type MfaRolloutReadiness,
} from "@repo/contracts/organizations";
import { z } from "zod";

import { AuthService } from "../../../auth/auth.service";
import { MfaService } from "../../../auth/mfa/mfa.service";
import { SupabaseService } from "../../../supabase/supabase.service";
import {
  TenantAdministrationProviderError,
  type DestructiveReauthenticationPort,
  type MfaFactorReadinessPort,
  type TenantClockPort,
  type TenantExportDownloadPort,
  type TenantRequestIdentityPort,
} from "../application/tenant-administration-use-cases";

const memberFactorRowSchema = z
  .object({ users: z.object({ auth_user_id: z.uuid() }).nullable() })
  .strict();

@Injectable()
export class SupabaseMfaFactorReadinessAdapter implements MfaFactorReadinessPort {
  constructor(private readonly supabase: SupabaseService) {}

  async read(orgId: string): Promise<MfaRolloutReadiness> {
    try {
      const client = this.supabase.admin();
      const { data, error } = await client
        .from("organization_members")
        .select("users(auth_user_id)")
        .eq("organization_id", orgId);
      if (error || !Array.isArray(data)) {
        throw new TenantAdministrationProviderError("unavailable");
      }
      const authUserIds = data.map((row) => {
        const parsed = memberFactorRowSchema.safeParse(row);
        if (!parsed.success || !parsed.data.users) {
          throw new TenantAdministrationProviderError("malformed");
        }
        return parsed.data.users.auth_user_id;
      });
      const factors = await Promise.all(
        authUserIds.map((userId) =>
          client.auth.admin.mfa.listFactors({ userId }),
        ),
      );
      if (
        factors.some(
          ({ data: value, error: factorError }) => factorError || !value,
        )
      ) {
        throw new TenantAdministrationProviderError("unavailable");
      }
      const enrolledMemberCount = factors.filter(({ data: value }) =>
        value?.factors.some((factor) => factor.status === "verified"),
      ).length;
      const parsed = mfaRolloutReadinessSchema.safeParse({
        enrolledMemberCount,
        unenrolledMemberCount: authUserIds.length - enrolledMemberCount,
        safeToEnforce: enrolledMemberCount === authUserIds.length,
      });
      if (!parsed.success) {
        throw new TenantAdministrationProviderError("malformed");
      }
      return Object.freeze(parsed.data);
    } catch (error) {
      if (error instanceof TenantAdministrationProviderError) throw error;
      throw new TenantAdministrationProviderError("unavailable");
    }
  }
}

@Injectable()
export class ExistingAuthDestructiveReauthenticationAdapter implements DestructiveReauthenticationPort {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  async verify(
    input: Readonly<{
      email: string;
      password: string;
      accessToken: string;
      actorId: string;
      mfaCode?: string;
    }>,
  ) {
    try {
      if (!(await this.auth.verifyPassword(input.email, input.password))) {
        return Object.freeze({ outcome: "invalid_password" as const });
      }
      if (!(await this.mfa.hasVerifiedFactor(input.accessToken))) {
        return Object.freeze({ outcome: "verified" as const });
      }
      if (!input.mfaCode) {
        return Object.freeze({ outcome: "mfa_required" as const });
      }
      await this.mfa.verify(input.accessToken, input.actorId, input.mfaCode);
      return Object.freeze({ outcome: "verified" as const });
    } catch (error) {
      const response =
        typeof error === "object" && error !== null && "getStatus" in error
          ? (error as { getStatus(): number }).getStatus()
          : 503;
      return Object.freeze({
        outcome:
          response >= 500 ? ("unavailable" as const) : ("invalid_mfa" as const),
      });
    }
  }
}

/** Task 3b replaces this fail-closed storage boundary. */
@Injectable()
export class UnavailableTenantExportDownloadAdapter implements TenantExportDownloadPort {
  createDownload() {
    return Promise.resolve(Object.freeze({ outcome: "unavailable" as const }));
  }
}

const verifiedExportRowSchema = z
  .object({
    artifact_object_path: z.string().min(1),
    artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("completed"),
    verified_at: z.string().min(1),
  })
  .strict();

/**
 * Service-role export download boundary. It neither exposes an object path nor
 * treats a storage URL as authorized before the org-scoped audit RPC succeeds.
 */
@Injectable()
export class SupabaseTenantExportDownloadAdapter implements TenantExportDownloadPort {
  private static readonly expiresInSeconds = 900;

  constructor(private readonly supabase: SupabaseService) {}

  async createDownload(orgId: string, exportId: string, actorId: string) {
    try {
      const client = this.supabase.admin();
      const { data, error } = await client
        .from("organization_export_jobs")
        .select("status, verified_at, artifact_object_path, artifact_sha256")
        .eq("organization_id", orgId)
        .eq("id", exportId)
        .maybeSingle();
      if (error) throw new TenantAdministrationProviderError("unavailable");
      const verified = verifiedExportRowSchema.safeParse(data);
      if (!verified.success)
        return Object.freeze({ outcome: "not_found" as const });

      const signed = await client.storage
        .from("tenant-exports")
        .createSignedUrl(
          verified.data.artifact_object_path,
          SupabaseTenantExportDownloadAdapter.expiresInSeconds,
          {
            download: "organization-export-v1.zip",
          },
        );
      if (signed.error || !signed.data?.signedUrl) {
        throw new TenantAdministrationProviderError("unavailable");
      }
      const parsedUrl = new URL(signed.data.signedUrl);
      if (parsedUrl.protocol !== "https:") {
        throw new TenantAdministrationProviderError("unavailable");
      }
      const audit = await client.rpc(
        "record_organization_export_download_atomic",
        {
          p_organization_id: orgId,
          p_export_job_id: exportId,
          p_actor_user_id: actorId,
        },
      );
      if (
        audit.error ||
        !Array.isArray(audit.data) ||
        audit.data.length !== 1
      ) {
        throw new TenantAdministrationProviderError("unavailable");
      }
      const outcome = audit.data[0];
      if (
        outcome === null ||
        typeof outcome !== "object" ||
        Array.isArray(outcome) ||
        (outcome as Readonly<Record<string, unknown>>).outcome !== "found"
      ) {
        return Object.freeze({ outcome: "not_found" as const });
      }
      const download = exportAttachmentDownloadResponseSchema.safeParse({
        url: parsedUrl.toString(),
        filename: "organization-export-v1.zip",
        expiresInSeconds: SupabaseTenantExportDownloadAdapter.expiresInSeconds,
      });
      if (!download.success)
        throw new TenantAdministrationProviderError("malformed");
      return Object.freeze({
        outcome: "available" as const,
        download: download.data,
      });
    } catch (error) {
      if (error instanceof TenantAdministrationProviderError) throw error;
      throw new TenantAdministrationProviderError("unavailable");
    }
  }
}

@Injectable()
export class NodeTenantRequestIdentityAdapter implements TenantRequestIdentityPort {
  create(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ) {
    const requestDigest = createHash("sha256")
      .update(
        JSON.stringify({
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          organizationId: input.organizationId,
          operation: "organization_export",
        }),
      )
      .digest("hex");
    return Object.freeze({ requestDigest, correlationId: randomUUID() });
  }
}

@Injectable()
export class SystemTenantClockAdapter implements TenantClockPort {
  now(): Date {
    return new Date();
  }
}
