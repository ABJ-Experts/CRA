import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import {
  diagnosticContentSchema,
  diagnosticPreviewSchema,
} from "@repo/contracts/support-diagnostics/schemas";
import type {
  SupportDiagnosticSelection,
  SupportDiagnosticCreate,
  SupportDiagnosticMutation,
  SupportDiagnosticCleanupInput,
  SupportDiagnosticListQuery,
  SupportDiagnosticContentQuery,
} from "@repo/contracts/support-diagnostics/types";
import type { RequestUser } from "../../auth/auth.types";
import {
  DiagnosticDeniedError,
  DiagnosticUnavailableError,
  DiagnosticInvalidError,
  type DiagnosticRepository,
  type DiagnosticPrincipal,
  type DiagnosticAccess,
} from "./diagnostic-repository.port";
import type {
  DiagnosticPreviewTokenPort,
  DiagnosticArtifactPort,
  DiagnosticArchivePort,
} from "./diagnostic-generation.port";
export class SupportDiagnosticsUseCases {
  constructor(
    private readonly repository: DiagnosticRepository,
    private readonly tokens: DiagnosticPreviewTokenPort,
    private readonly artifacts: DiagnosticArtifactPort,
    private readonly archive: DiagnosticArchivePort,
    private readonly now: () => number = Date.now,
  ) {}
  async preview(user: RequestUser, selection: SupportDiagnosticSelection) {
    const p = principal(user);
    if (Date.parse(selection.to) > this.now())
      throw new DiagnosticInvalidError();
    const authority = await this.repository.authority(p.organizationId, p);
    const issued = this.tokens.mint({
      ...p,
      authRevision: authority.permissionVersion,
      selection,
    });
    return diagnosticPreviewSchema.parse({
      organizationId: p.organizationId,
      disclosureVersion: "m15_04_v1",
      selection,
      estimate: { maxBytes: 10485760, maxLogRows: 5000, measured: false },
      fields: {
        logs: ["at", "source", "code", "outcome"],
        configuration: [
          "observedAt",
          "accessTokenSeconds",
          "refreshTokenSeconds",
          "smtpTlsMode",
          "maxBundleBytes",
          "maxLogRows",
        ],
        metrics: [
          "source",
          "status",
          "sourceAt",
          "observedAt",
          "pending",
          "running",
          "failedTerminal",
          "storageBytes",
        ],
      },
      examples: {
        logs: "Operation outcome with a fixed source alias; no message text or identities",
        configuration:
          "Session lifetime and SMTP TLS mode; no environment values",
        metrics:
          "Source status and bounded queue or storage counts; no identifiers",
      },
      ...issued,
    });
  }
  async create(user: RequestUser, input: SupportDiagnosticCreate) {
    const p = principal(user);
    const authority = await this.repository.authority(p.organizationId, p);
    let selection: SupportDiagnosticSelection;
    try {
      selection = this.tokens.verify(input.previewToken, {
        ...p,
        authRevision: authority.permissionVersion,
      });
    } catch {
      throw new DiagnosticDeniedError();
    }
    if (input.consent !== true) throw new DiagnosticDeniedError();
    return this.repository.create(
      p.organizationId,
      p,
      selection,
      digest(input.previewToken),
      input.idempotencyKey,
    );
  }
  list(user: RequestUser, query: SupportDiagnosticListQuery) {
    const p = principal(user);
    return this.repository.list(p.organizationId, p, query);
  }
  get(user: RequestUser, jobId: string) {
    const p = principal(user);
    return this.repository.get(p.organizationId, p, jobId);
  }
  cancel(user: RequestUser, jobId: string, input: SupportDiagnosticMutation) {
    const p = principal(user);
    return this.repository.cancel(p.organizationId, p, jobId, input);
  }
  cleanupReview(user: RequestUser, jobId: string) {
    const p = principal(user);
    return this.repository.cleanupReview(p.organizationId, p, jobId);
  }
  cleanup(
    user: RequestUser,
    jobId: string,
    input: SupportDiagnosticCleanupInput,
  ) {
    const p = principal(user);
    return this.repository.cleanup(p.organizationId, p, jobId, input);
  }
  async grant(
    user: RequestUser,
    jobId: string,
    input: SupportDiagnosticMutation,
  ) {
    const p = principal(user);
    const { grantId, cookieValue } = this.tokens.deriveGrant(
      p,
      jobId,
      input.idempotencyKey,
    );
    const grant = await this.repository.grant(
      p.organizationId,
      p,
      jobId,
      input,
      grantId,
      digest(cookieValue),
    );
    return { grant, cookieValue };
  }
  async content(
    user: RequestUser,
    jobId: string,
    query: SupportDiagnosticContentQuery,
  ) {
    const p = principal(user);
    const requestId = randomUUID();
    const access = await this.repository.access(
      p.organizationId,
      p,
      jobId,
      requestId,
    );
    const bytes = await this.read(p, jobId, access);
    const payload = await this.archive.inspect(bytes).catch(() => {
      throw new DiagnosticUnavailableError();
    });
    const { manifest } = payload;
    if (
      manifest.jobId !== jobId ||
      !isDeepStrictEqual(manifest, access.manifest)
    )
      throw new DiagnosticUnavailableError();
    await this.repository.revalidate(p.organizationId, p, jobId, requestId);
    const base = {
      organizationId: p.organizationId,
      jobId,
      manifest,
      section: query.section,
    };
    if (query.section === "configuration")
      return diagnosticContentSchema.parse({
        ...base,
        data: payload.configuration,
        nextOffset: null,
      });
    const rows = payload[query.section] ?? [];
    const end = query.offset + query.limit;
    return diagnosticContentSchema.parse({
      ...base,
      data: rows.slice(query.offset, end),
      nextOffset: end < rows.length ? end : null,
    });
  }
  async download(
    user: RequestUser,
    jobId: string,
    grantId: string,
    cookieValue: string | undefined,
  ) {
    const p = principal(user);
    if (!cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue))
      throw new DiagnosticDeniedError();
    const requestId = randomUUID();
    const access = await this.repository.redeem(
      p.organizationId,
      p,
      jobId,
      grantId,
      digest(cookieValue),
      requestId,
    );
    const bytes = await this.read(p, jobId, access);
    const repository = this.repository;
    await repository.revalidate(p.organizationId, p, jobId, requestId);
    const body = Readable.from(
      (async function* () {
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          await repository.revalidate(p.organizationId, p, jobId, requestId);
          yield bytes.subarray(offset, offset + 65536);
        }
      })(),
    );
    return {
      body,
      byteSize: bytes.length,
      sha256: digest(bytes),
      fileName: `support-diagnostics-${jobId}.zip`,
    };
  }
  private async read(
    p: DiagnosticPrincipal,
    jobId: string,
    access: DiagnosticAccess,
  ) {
    const artifact = access.job.artifact;
    if (
      !access.objectPath.startsWith(`${p.organizationId}/${jobId}/`) ||
      access.job.id !== jobId ||
      access.job.organizationId !== p.organizationId ||
      access.job.state !== "ready" ||
      !artifact ||
      !access.job.expiresAt ||
      Date.parse(access.job.expiresAt) <= Date.now()
    )
      throw new DiagnosticDeniedError();
    const bytes = await this.artifacts
      .read(p.organizationId, access.objectPath, artifact)
      .catch(() => {
        throw new DiagnosticUnavailableError();
      });
    if (
      bytes.length > 10485760 ||
      bytes.length !== artifact.byteSize ||
      digest(bytes) !== artifact.sha256
    )
      throw new DiagnosticUnavailableError();
    return bytes;
  }
}
function principal(user: RequestUser): DiagnosticPrincipal {
  if (
    !user.isActive ||
    !user.organizationId ||
    !user.sessionId ||
    (user.role !== "owner" && user.role !== "admin")
  )
    throw new DiagnosticDeniedError();
  return {
    organizationId: user.organizationId,
    actorId: user.id,
    sessionId: user.sessionId,
  };
}
function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
