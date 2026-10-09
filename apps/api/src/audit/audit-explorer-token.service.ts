import {
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type {
  AuditCursorTokenPayload,
  AuditDownloadGrantPayload,
  AuditExplorerTokenCodec,
  AuditSnapshotTokenPayload,
  AuditTokenPrincipal,
} from "./application/audit-explorer.port";

const TOKEN_VERSION = "v1";
const TOKEN_SALT = "cra:audit-explorer:v1";

type AuditTokenPayload =
  | AuditSnapshotTokenPayload
  | AuditCursorTokenPayload
  | AuditDownloadGrantPayload;

@Injectable()
export class AuditExplorerTokenService implements AuditExplorerTokenCodec {
  constructor(private readonly config: ConfigService) {}

  snapshot(payload: AuditSnapshotTokenPayload): string {
    return this.seal("snapshot", payload);
  }

  openSnapshot(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditSnapshotTokenPayload {
    const payload = this.open("snapshot", token);
    if (payload.kind !== "snapshot") throw new Error("invalid token kind");
    this.assertPrincipal(payload, principal);
    this.assertFresh(payload.expiresAt);
    return payload;
  }

  cursor(payload: AuditCursorTokenPayload): string {
    return this.seal("cursor", payload);
  }

  openCursor(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditCursorTokenPayload {
    const payload = this.open("cursor", token);
    if (payload.kind !== "cursor") throw new Error("invalid token kind");
    this.assertPrincipal(payload, principal);
    return payload;
  }

  downloadGrant(payload: AuditDownloadGrantPayload): string {
    return this.seal("download", payload);
  }

  openDownloadGrant(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditDownloadGrantPayload {
    const payload = this.open("download", token);
    if (payload.kind !== "download") throw new Error("invalid token kind");
    this.assertPrincipal(payload, principal);
    this.assertFresh(payload.expiresAt);
    return payload;
  }

  digest(value: unknown): string {
    return sha256Hex(stableStringify(value));
  }

  randomDigest(): string {
    return sha256Hex(randomBytes(32));
  }

  private seal(domain: string, payload: AuditTokenPayload): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(domain), iv);
    const plaintext = Buffer.from(stableStringify(payload), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [TOKEN_VERSION, b64(iv), b64(encrypted), b64(tag)].join(".");
  }

  private open(domain: string, token: string): AuditTokenPayload {
    const [version, ivPart, encryptedPart, tagPart, extra] = token.split(".");
    if (
      version !== TOKEN_VERSION ||
      !ivPart ||
      !encryptedPart ||
      !tagPart ||
      extra
    ) {
      throw new Error("invalid token envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(domain),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as AuditTokenPayload;
  }

  private key(domain: string): Buffer {
    const secret = this.config.getOrThrow<string>("COOKIE_SIGNING_SECRET");
    return Buffer.from(hkdfSync("sha256", secret, TOKEN_SALT, domain, 32));
  }

  private assertPrincipal(
    payload: AuditTokenPrincipal,
    principal: AuditTokenPrincipal,
  ): void {
    if (
      payload.organizationId !== principal.organizationId ||
      payload.actorId !== principal.actorId ||
      payload.sessionId !== principal.sessionId
    ) {
      throw new Error("token principal mismatch");
    }
  }

  private assertFresh(expiresAt: string): void {
    if (Date.parse(expiresAt) <= Date.now()) throw new Error("token expired");
  }
}

function b64(value: Buffer): string {
  return value.toString("base64url");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
