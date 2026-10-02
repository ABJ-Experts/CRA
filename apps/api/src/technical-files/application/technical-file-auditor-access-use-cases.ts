import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CreateTechnicalFileAuditorGrantRequest,
  RevokeTechnicalFileAuditorGrantRequest,
} from "@repo/contracts/technical-files";

import type { ProductRetentionReaderPort } from "../../products/application/product-retention-reader.port";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import type {
  TechnicalFileAuditorAccessRepository,
  TechnicalFileAuditorArtifact,
} from "./technical-file-auditor-access.port";

export const AUDITOR_SESSION_MAX_AGE_SECONDS = 10 * 60;

/** Applies verified product scope before tenant grant operations. */
export class TechnicalFileAuditorAccessUseCases {
  constructor(
    private readonly repository: TechnicalFileAuditorAccessRepository,
    private readonly retention: ProductRetentionReaderPort,
  ) {}

  async preview(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
    }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.preview(organizationId, input);
  }

  async list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.list(organizationId, input);
  }

  async create(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
      } & CreateTechnicalFileAuditorGrantRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    const token = randomBytes(32).toString("base64url");
    const grant = await this.repository.create(organizationId, {
      ...input,
      grantId: randomUUID(),
      tokenHash: digest(token),
      requestDigest: digest(
        JSON.stringify({
          exportId: input.exportId,
          recipientReference: input.recipientReference ?? input.recipientEmail,
          purpose: input.purpose,
          expiresAt: input.expiresAt,
        }),
      ),
    });
    return grant ? { grant, token } : null;
  }

  async revoke(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        grantId: string;
      } & RevokeTechnicalFileAuditorGrantRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.revoke(organizationId, input);
  }

  async redeem(token: string, clientSource: string | undefined) {
    const sessionToken = randomBytes(32).toString("base64url");
    const result = await this.repository.redeem({
      tokenHash: digest(token),
      sessionId: randomUUID(),
      sessionTokenHash: digest(sessionToken),
      sessionExpiresAt: new Date(
        Date.now() + AUDITOR_SESSION_MAX_AGE_SECONDS * 1000,
      ).toISOString(),
      clientSourceHash: clientSource ? digest(clientSource) : null,
    });
    return result ? { ...result, sessionToken } : null;
  }

  async view(sessionToken: string) {
    return this.repository.view(digest(sessionToken));
  }

  async manifest(sessionToken: string) {
    return this.repository.manifest(digest(sessionToken));
  }

  async artifact(sessionToken: string, artifact: TechnicalFileAuditorArtifact) {
    return this.repository.artifact(digest(sessionToken), artifact);
  }

  private async productExists(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const result = await this.retention.getProductRetentionCalculation({
      organizationId,
      actorId: input.actorId,
      productId: input.productId,
    });
    if (!result.ok) throw new TechnicalFileProductUnavailableError();
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
