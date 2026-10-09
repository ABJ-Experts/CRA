import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { DashboardCursorScope } from "../application/dashboard-read.port";
import {
  DashboardDatasetConflictError,
  type DashboardDatasetTokens,
} from "../application/dashboard-trends.port";

const payloadSchema = z
  .object({
    scope: z.string(),
    expiresAt: z.number().int().positive(),
    position: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Same authenticated encryption pattern as audit tokens, with an isolated key context. */
export class DashboardDatasetCodec implements DashboardDatasetTokens {
  constructor(private readonly secret: string) {}

  fingerprint(value: unknown): string {
    return createHash("sha256").update(canonical(value)).digest("hex");
  }

  /** Global source sequences must never become observable public identifiers. */
  opaqueSourceId(
    scope: DashboardCursorScope,
    dataset: Readonly<Record<string, unknown>>,
    sourceId: string,
  ): string {
    const digest = createHmac("sha256", this.key("source-id"))
      .update(
        canonical({
          purpose: "cra:dashboard:trends:source-id:v1",
          scope,
          dataset,
          sourceId,
        }),
      )
      .digest("base64url");
    return `source_${digest}`;
  }

  seal(
    scope: DashboardCursorScope,
    position: Readonly<Record<string, unknown>>,
    now = Date.now(),
  ): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const bytes = Buffer.from(
      JSON.stringify({
        scope: this.fingerprint(scope),
        expiresAt: now + 900_000,
        position,
      }),
    );
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const token = Buffer.from(
      [
        "v1",
        iv.toString("base64url"),
        encrypted.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join("."),
    ).toString("base64url");
    if (token.length > 16384) throw new Error("Dataset snapshot exceeds bound");
    return token;
  }

  open(
    token: string,
    scope: DashboardCursorScope,
  ): Readonly<Record<string, unknown>> {
    try {
      if (token.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(token))
        throw new Error();
      const [version, iv, encrypted, tag, extra] = Buffer.from(
        token,
        "base64url",
      )
        .toString("utf8")
        .split(".");
      if (version !== "v1" || !iv || !encrypted || !tag || extra)
        throw new Error();
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(),
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]);
      const payload = payloadSchema.parse(
        JSON.parse(plaintext.toString("utf8")),
      );
      if (
        payload.scope !== this.fingerprint(scope) ||
        payload.expiresAt <= Date.now()
      )
        throw new Error();
      return payload.position;
    } catch {
      throw new DashboardDatasetConflictError(
        "Dataset expired or scope changed",
      );
    }
  }

  private key(purpose: "dataset" | "source-id" = "dataset"): Buffer {
    return Buffer.from(
      hkdfSync("sha256", this.secret, "cra:dashboard:trends:v1", purpose, 32),
    );
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
