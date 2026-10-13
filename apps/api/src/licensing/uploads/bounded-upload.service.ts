import { UPLOAD_BUCKET_LIMITS, UPLOAD_BUCKET_TTL_MS } from "./upload-limits";
import { LicensingService } from "../application/licensing.service";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fromBuffer } from "file-type";
import { z } from "zod";
import { inspectEvidenceMediaType } from "../../common/storage/evidence-media-inspection";
import { SupabaseService } from "../../supabase/supabase.service";
import { stageBoundedUpload } from "./bounded-upload-stage";
import type { UploadScope } from "./upload-scope";

const claimSchema = z
  .object({
    outcome: z.literal("claimed"),
    organizationId: z.uuid(),
    actorUserId: z.uuid().nullable(),
    bucket: z.enum([
      "reporting-evidence",
      "evidence-documents",
      "sbom-originals",
      "security-update-artifacts",
      "product-imports",
      "organization-branding",
    ]),
    objectPath: z.string().min(1),
    bytes: z.number().int().positive().max(2_147_483_647),
    contentType: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .refine((value) => value.bytes <= UPLOAD_BUCKET_LIMITS[value.bucket], {
    message: "Source upload limit exceeded",
  });
const capability = {
  "reporting-evidence": "reporting",
  "evidence-documents": "evidence",
  "sbom-originals": "sboms",
  "security-update-artifacts": "products",
  "product-imports": "products",
  "organization-branding": "administration",
} as const;

@Injectable()
export class BoundedUploadService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly licensing: LicensingService,
  ) {}

  async issue(
    input: Readonly<{
      objectKey: string;
      byteSize: number;
      contentType: string;
      bucket: keyof typeof capability;
      scope: UploadScope;
    }>,
  ) {
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > UPLOAD_BUCKET_LIMITS[input.bucket]
    )
      throw new BadRequestException("Invalid upload size");
    const token = randomBytes(32).toString("base64url");
    const operationId = randomUUID();
    const expiresAt = new Date(
      Date.now() + UPLOAD_BUCKET_TTL_MS[input.bucket],
    ).toISOString();
    const organizationId =
      "organizationId" in input.scope
        ? input.scope.organizationId
        : await this.resolveSourceOrganization(input);
    if (input.scope.kind === "reporting_receipt")
      await this.licensing.getWorkerPolicy(organizationId);
    if (
      input.scope.kind !== "reporting_receipt" &&
      !(await this.licensing.canClaim(organizationId, capability[input.bucket]))
    )
      throw new ForbiddenException("Storage admission denied by licence");
    const actorId =
      input.scope.kind === "member" || input.scope.kind === "reporting_receipt"
        ? input.scope.actorId
        : null;
    await this.reconcileAbandoned(organizationId);
    const result = await this.rpc("m15_01_reserve_storage", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_operation_id: operationId,
      p_bucket: input.bucket,
      p_object_path: input.objectKey,
      p_bytes: input.byteSize,
      p_token_digest: digest(token),
      p_expires_at: expiresAt,
      p_capability: capability[input.bucket],
      p_source_context: input.scope.kind === "member" ? null : input.scope,
      p_content_type: input.contentType,
    });
    if (result.outcome === "quota_exceeded")
      throw new ForbiddenException(
        "The verified licence storage limit has been reached",
      );
    if (result.outcome === "accounting_unavailable")
      throw new ServiceUnavailableException(
        "Storage accounting is unavailable",
      );
    if (result.outcome === "license_denied")
      throw new ForbiddenException(
        "Storage admission is paused by the verified licence",
      );
    if (result.outcome !== "reserved" && result.outcome !== "replayed")
      throw new ForbiddenException("Storage admission denied");
    const admittedOperation = z.uuid().safeParse(result.operationId);
    if (!admittedOperation.success)
      throw new ServiceUnavailableException("Upload admission unavailable");
    const origin =
      this.config.get<string>("API_PUBLIC_ORIGIN") ??
      this.config.get<string>("APP_URL") ??
      `http://localhost:${this.config.get<number>("PORT") ?? 3333}`;
    const base = new URL(origin);
    if (
      base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      )
    )
      throw new ServiceUnavailableException("Upload origin unavailable");
    return Object.freeze({
      uploadUrl: new URL(
        `/api/v1/licensing/uploads/${admittedOperation.data}/${token}`,
        base,
      ).toString(),
      expiresAt,
    });
  }

  private async reconcileAbandoned(orgId: string): Promise<void> {
    const abandoned = await this.supabase
      .admin()
      .rpc("m15_01_reconcile_abandoned_reservations", {
        p_organization_id: orgId,
        p_limit: 100,
      });
    if (
      abandoned.error ||
      !Number.isInteger(abandoned.data) ||
      Number(abandoned.data) < 0
    )
      throw new ServiceUnavailableException(
        "Storage reconciliation unavailable",
      );
  }

  async write(
    input: Readonly<{
      objectKey: string;
      bytes: Buffer;
      contentType: string;
      bucket: keyof typeof capability;
      scope: UploadScope;
    }>,
  ): Promise<void> {
    if (input.scope.kind === "reporting_receipt") {
      await this.licensing.getWorkerPolicy(input.scope.organizationId);
      const replay = await this.rpc("m15_01_replay_reporting_receipt", {
        p_organization_id: input.scope.organizationId,
        p_actor_user_id: input.scope.actorId,
        p_object_path: input.objectKey,
        p_bytes: input.bytes.byteLength,
        p_content_type: input.contentType,
        p_sha256: createHash("sha256").update(input.bytes).digest("hex"),
        p_context: input.scope,
      });
      if (replay.outcome === "completed") return;
      if (replay.outcome !== "absent")
        throw new ForbiddenException("Receipt replay authority unavailable");
    }
    const issued = await this.issue({
      ...input,
      byteSize: input.bytes.byteLength,
    });
    const parts = new URL(issued.uploadUrl).pathname.split("/");
    await this.accept(
      parts.at(-2)!,
      parts.at(-1)!,
      String(input.bytes.byteLength),
      Readable.from([input.bytes]),
    );
  }

  async accept(
    operationId: string,
    token: string,
    contentLength: string | undefined,
    source: Readable,
  ): Promise<void> {
    if (
      !z.uuid().safeParse(operationId).success ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    )
      throw new ForbiddenException("Invalid upload authority");
    if (!contentLength || !/^\d+$/.test(contentLength))
      throw new BadRequestException("Content-Length is required");
    const claim = await this.rpc("m15_01_claim_storage_upload", {
      p_operation_id: operationId,
      p_token_digest: digest(token),
    });
    if (claim.outcome !== "claimed") {
      const reconciled = await this.rpc("m15_01_reconcile_storage_upload", {
        p_operation_id: operationId,
        p_token_digest: digest(token),
      });
      if (
        reconciled.outcome === "completed" ||
        reconciled.outcome === "replayed"
      )
        return;
      throw new ConflictException("Upload authority unavailable");
    }
    const parsed = claimSchema.safeParse(claim);
    if (!parsed.success)
      throw new ServiceUnavailableException("Upload admission unavailable");
    const authority = parsed.data;
    let staged: Awaited<ReturnType<typeof stageBoundedUpload>> | undefined;
    let publicationAttempted = false;
    try {
      if (Number(contentLength) !== authority.bytes)
        throw new BadRequestException("Upload length mismatch");
      const remainingMilliseconds = Math.max(
        1,
        Math.min(
          UPLOAD_BUCKET_TTL_MS[authority.bucket],
          Date.parse(authority.expiresAt) - Date.now(),
        ),
      );
      staged = await stageBoundedUpload(
        source,
        authority.bytes,
        AbortSignal.timeout(remainingMilliseconds),
      );
      const expectedHash = authority.objectPath.split("/").at(-1);
      if (
        /^[a-f0-9]{64}$/.test(expectedHash ?? "") &&
        staged.sha256 !== expectedHash
      )
        throw new BadRequestException("Upload hash mismatch");
      const publicationContentType = await this.inspectPublicationType(
        authority,
        staged,
      );
      const validated = await this.rpc("m15_01_prepare_storage_publication", {
        p_operation_id: operationId,
        p_token_digest: digest(token),
        p_sha256: staged.sha256,
      });
      if (validated.outcome !== "authorized")
        throw new ForbiddenException("Upload authority revoked");
      publicationAttempted = true;
      await this.publish(
        authority.organizationId,
        authority,
        staged,
        operationId,
        publicationContentType,
      );
      const completed = await this.rpc("m15_01_complete_storage", {
        p_organization_id: authority.organizationId,
        p_actor_user_id: authority.actorUserId,
        p_operation_id: operationId,
        p_token_digest: digest(token),
        p_observed_bytes: staged.byteSize,
      });
      if (completed.outcome !== "completed" && completed.outcome !== "replayed")
        throw new ServiceUnavailableException("Storage completion unavailable");
    } catch (error) {
      if (publicationAttempted) {
        const reconciled = await this.rpc("m15_01_reconcile_storage_upload", {
          p_operation_id: operationId,
          p_token_digest: digest(token),
        });
        if (
          reconciled.outcome === "completed" ||
          reconciled.outcome === "replayed"
        )
          return;
      }
      if (!publicationAttempted)
        await this.rpc("m15_01_reset_storage_upload", {
          p_operation_id: operationId,
          p_token_digest: digest(token),
        });
      if (error instanceof Error && error.message === "upload_length_mismatch")
        throw new BadRequestException("Upload length mismatch");
      throw error;
    } finally {
      await staged?.dispose();
    }
  }

  private async publish(
    orgId: string,
    authority: z.output<typeof claimSchema>,
    staged: Awaited<ReturnType<typeof stageBoundedUpload>>,
    operationId: string,
    contentType: string,
  ): Promise<void> {
    if (orgId !== authority.organizationId)
      throw new ForbiddenException("Upload tenant binding mismatch");
    const upload = await this.supabase
      .admin()
      .storage.from(authority.bucket)
      .upload(authority.objectPath, createReadStream(staged.path), {
        upsert: false,
        contentType,
        duplex: "half",
        metadata: { sha256: staged.sha256, operationId },
      });
    if (upload.error)
      throw new ServiceUnavailableException("Storage publication unavailable");
  }

  private async inspectPublicationType(
    authority: z.output<typeof claimSchema>,
    staged: Awaited<ReturnType<typeof stageBoundedUpload>>,
  ): Promise<string> {
    if (authority.bucket === "evidence-documents") {
      const mediaType = await inspectEvidenceMediaType(
        staged.probe,
        staged.probe.toString("utf8"),
        () => readFile(staged.path),
      );
      if (!mediaType)
        throw new BadRequestException(
          "Unsupported or disguised evidence content",
        );
      return mediaType;
    }
    const detected = await fromBuffer(staged.probe);
    if (
      detected &&
      authority.contentType !== "application/octet-stream" &&
      detected.mime !== authority.contentType
    )
      throw new BadRequestException("Upload content mismatch");
    return authority.contentType;
  }

  private async resolveSourceOrganization(
    input: Readonly<{
      objectKey: string;
      byteSize: number;
      bucket: keyof typeof capability;
      scope: UploadScope;
    }>,
  ): Promise<string> {
    const client = this.supabase.admin() as unknown as {
      rpc(
        name: string,
        args: Readonly<Record<string, unknown>>,
      ): Promise<{ data: unknown; error: unknown }>;
    };
    const result = await client.rpc("m15_01_resolve_upload_owner", {
      p_bucket: input.bucket,
      p_object_path: input.objectKey,
      p_bytes: input.byteSize,
      p_source_context: input.scope,
    });
    const parsed = z.uuid().safeParse(result.data);
    if (result.error || !parsed.success)
      throw new ForbiddenException("Upload source authority unavailable");
    return parsed.data;
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const client = this.supabase.admin() as unknown as {
      rpc(
        name: string,
        args: Readonly<Record<string, unknown>>,
      ): Promise<{ data: unknown; error: unknown }>;
    };
    const response = await client.rpc(name, args);
    if (response.error)
      throw new ServiceUnavailableException("Upload admission unavailable");
    const parsed = z.record(z.string(), z.unknown()).safeParse(response.data);
    if (!parsed.success)
      throw new ServiceUnavailableException("Upload admission unavailable");
    return parsed.data;
  }
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
