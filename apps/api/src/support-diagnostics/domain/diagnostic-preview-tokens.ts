import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { diagnosticSelectionSchema } from "@repo/contracts/support-diagnostics";
import type { SupportDiagnosticSelection } from "@repo/contracts/support-diagnostics";

const authoritySchema = z.strictObject({
  organizationId: z.uuid(),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  authRevision: z.string().min(1).max(200),
});
const tokenSchema = authoritySchema
  .extend({
    purpose: z.literal("m15_04_preview_consent"),
    selection: diagnosticSelectionSchema,
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
export type DiagnosticTokenAuthority = z.output<typeof authoritySchema>;

export class DiagnosticPreviewTokens {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (Buffer.byteLength(secret) < 32)
      throw new Error("diagnostic_signing_key_required");
  }
  mint(
    input: DiagnosticTokenAuthority & { selection: SupportDiagnosticSelection },
  ): { previewToken: string; expiresAt: string } {
    const issuedAt = this.now();
    const payload = tokenSchema.parse({
      ...input,
      purpose: "m15_04_preview_consent",
      issuedAt,
      expiresAt: issuedAt + 600_000,
    });
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return {
      previewToken: `${body}.${this.signature(body).toString("base64url")}`,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    };
  }
  verify(
    token: string,
    authority: DiagnosticTokenAuthority,
  ): SupportDiagnosticSelection {
    if (token.length > 8192) throw new Error("invalid_preview");
    const parts = token.split(".");
    if (
      parts.length !== 2 ||
      !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
    )
      throw new Error("invalid_preview");
    const [body, signature] = parts as [string, string];
    const provided = Buffer.from(signature, "base64url");
    const expected = this.signature(body);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      throw new Error("invalid_preview");
    const payload = tokenSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    const checked = authoritySchema.safeParse(authority);
    if (!checked.success) throw new Error("access_changed");
    const bound = checked.data;
    if (
      Object.entries(bound).some(
        ([key, value]) =>
          payload[key as keyof DiagnosticTokenAuthority] !== value,
      )
    )
      throw new Error("access_changed");
    const now = this.now();
    if (
      payload.expiresAt <= now ||
      payload.issuedAt > now ||
      payload.expiresAt - payload.issuedAt !== 600_000
    )
      throw new Error("preview_expired");
    return payload.selection;
  }
  deriveGrant(
    authority: Pick<
      DiagnosticTokenAuthority,
      "organizationId" | "actorId" | "sessionId"
    >,
    jobId: string,
    idempotencyKey: string,
  ): { grantId: string; cookieValue: string } {
    const parsed = authoritySchema.omit({ authRevision: true }).parse({
      organizationId: authority.organizationId,
      actorId: authority.actorId,
      sessionId: authority.sessionId,
    });
    const body = JSON.stringify({
      ...parsed,
      jobId: z.uuid().parse(jobId),
      idempotencyKey: z.uuid().parse(idempotencyKey),
    });
    const cookieValue = createHmac("sha256", this.secret)
      .update("m15_04_download_cookie\0")
      .update(body)
      .digest("hex");
    const raw = createHmac("sha256", this.secret)
      .update("m15_04_download_grant_id\0")
      .update(body)
      .digest()
      .subarray(0, 16);
    raw[6] = (raw[6]! & 0x0f) | 0x40;
    raw[8] = (raw[8]! & 0x3f) | 0x80;
    const hex = raw.toString("hex");
    return {
      grantId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      cookieValue,
    };
  }
  private signature(body: string): Buffer {
    return createHmac("sha256", this.secret)
      .update("m15_04_preview_consent\0")
      .update(body)
      .digest();
  }
}
