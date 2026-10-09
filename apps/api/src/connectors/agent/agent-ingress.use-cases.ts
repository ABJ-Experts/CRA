import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { TLSSocket } from "node:tls";
import { z } from "zod";
import * as schemas from "@repo/contracts/connectors/schemas";
import type { z as Zod } from "zod";
import type { Request } from "express";
import { verifyAgentFrame } from "../agent-trust/verify-agent-frame";
import {
  AgentCertificateAuthority,
  AgentCsrError,
  verifiedPeerFingerprint,
  type AgentCertIdentity,
} from "./agent-certificate-authority";
import { agentHttpError } from "./agent-errors";
import { SupabaseAgentRepository } from "./supabase-agent.repository";

const headerSchema = z
  .object({
    agentId: z.uuid(),
    timestamp: z.iso.datetime({ offset: true }),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,120}$/),
    signature: z.string().regex(/^[0-9a-f]{64}$/),
    keyId: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),
  })
  .strict();
const identitySchema = z.object({
  version: z.literal(1),
  organizationId: z.uuid(),
  connectorId: z.uuid(),
  agentId: z.uuid(),
});
type Frame = Zod.output<typeof schemas.agentFrameBodySchema>;

function reject(code: string, status = HttpStatus.UNAUTHORIZED): never {
  throw new HttpException(
    { code, message: "Agent frame could not be accepted." },
    status,
  );
}

/** Isolated ingress: there is no browser session, proxy identity, or command route. */
export class AgentIngressUseCases {
  constructor(
    private readonly repository: SupabaseAgentRepository,
    private readonly ca: AgentCertificateAuthority,
  ) {}
  private async issueCertificate(ids: AgentCertIdentity, csrPem: string) {
    try {
      return await this.ca.issue(ids, csrPem);
    } catch (error) {
      if (error instanceof AgentCsrError)
        throw new BadRequestException({
          code: "invalid_csr",
          message: "The agent CSR is invalid or unsupported.",
        });
      throw new ServiceUnavailableException({ code: "unavailable" });
    }
  }
  async enroll(input: Zod.output<typeof schemas.agentEnrollInputSchema>) {
    const candidate = await this.repository.findEnrollment(input.token);
    if (!candidate) throw new GoneException({ code: "invalid_enrollment" });
    if (
      candidate.enrollment_expires_at &&
      Date.parse(candidate.enrollment_expires_at) < Date.now()
    )
      throw new GoneException({ code: "expired" });
    const issued = await this.issueCertificate(
      {
        agentId: candidate.id,
        organizationId: candidate.organization_id,
        connectorId: candidate.connector_id,
      },
      input.csrPem,
    );
    try {
      return schemas.agentEnrollResponseSchema.parse(
        await this.repository.redeemEnrollment(
          input.token,
          input.csrPem,
          issued,
        ),
      );
    } catch (error) {
      throw agentHttpError(error);
    }
  }
  async acceptFrame(
    request: Request & { rawBody?: Buffer },
    parsedFrame: Frame,
  ) {
    if (request.headers["content-type"] !== "application/json")
      reject("unsupported_content_type", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    if (request.headers["content-encoding"] !== undefined)
      reject("unsupported_content_encoding", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    const body = request.rawBody;
    if (!body || body.length > 4 * 1024 * 1024)
      reject("payload_too_large", HttpStatus.PAYLOAD_TOO_LARGE);
    if (!Buffer.from(body.toString("utf8"), "utf8").equals(body))
      reject("malformed", HttpStatus.BAD_REQUEST);
    if (
      request.method !== "POST" ||
      request.originalUrl !== "/api/v1/agent/frames"
    )
      reject("invalid_route");
    const headers = headerSchema.safeParse({
      agentId: request.header("x-cra-agent-id"),
      timestamp: request.header("x-cra-timestamp"),
      nonce: request.header("x-cra-nonce"),
      signature: request.header("x-cra-signature"),
      keyId: request.header("x-cra-key-id"),
    });
    if (!headers.success) reject("invalid_frame_headers");
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body.toString("utf8"));
    } catch {
      reject("malformed", HttpStatus.BAD_REQUEST);
    }
    const identity = identitySchema.safeParse(parsedBody);
    if (!identity.success || headers.data.agentId !== identity.data.agentId)
      reject("identity_mismatch");
    const ids = identity.data;
    // The only channel identity is the validated TLS peer certificate. Never
    // consume Forwarded/SSL-Client-Cert headers from a reverse proxy.
    const fingerprint = verifiedPeerFingerprint(
      request.socket as TLSSocket,
      ids,
    );
    if (!fingerprint) reject("client_certificate_required");
    const row = await this.repository.findAgent(
      ids.organizationId,
      ids.connectorId,
      ids.agentId,
    );
    if (!row) reject("unknown_agent");
    const selected = this.repository.signingKey(
      row,
      headers.data.keyId,
      fingerprint,
    );
    if (!selected) reject("identity_mismatch");
    const raw = body.toString("utf8");
    const verified = await verifyAgentFrame(
      {
        timestamp: headers.data.timestamp,
        nonce: headers.data.nonce,
        method: request.method,
        path: request.originalUrl,
        body: raw,
        contentType: "application/json",
        signature: headers.data.signature,
        targetOrganizationId: ids.organizationId,
        targetConnectorId: ids.connectorId,
      },
      {
        findByAgentId: (agentId) =>
          Promise.resolve(
            agentId === ids.agentId
              ? {
                  agentId,
                  organizationId: ids.organizationId,
                  connectorId: ids.connectorId,
                  signingKey: selected.key,
                  signingKeyIssuedAt: selected.issuedAt,
                  revoked: row.status !== "active",
                }
              : null,
          ),
      },
      {
        consumeIfAbsent: (agentId, nonce) =>
          this.repository.consumeNonce(
            ids.organizationId,
            ids.connectorId,
            agentId,
            fingerprint,
            headers.data.keyId,
            nonce,
          ),
      },
      ids.agentId,
    );
    if (verified.outcome === "rejected") {
      if (
        verified.reason === "clock_skew" ||
        verified.reason === "key_rotation_required"
      )
        reject(verified.reason, HttpStatus.BAD_REQUEST);
      if (verified.reason === "replay") reject("replay", HttpStatus.CONFLICT);
      reject(verified.reason);
    }
    if (
      parsedFrame.organizationId !== ids.organizationId ||
      parsedFrame.connectorId !== ids.connectorId ||
      parsedFrame.agentId !== ids.agentId
    )
      reject("identity_mismatch");
    try {
      return schemas.agentFrameResponseSchema.parse(
        await this.applyFrame(parsedFrame),
      );
    } catch (error) {
      throw agentHttpError(error);
    }
  }
  private async applyFrame(frame: Frame) {
    const { organizationId, connectorId, agentId } = frame;
    if (frame.kind === "heartbeat")
      return this.repository.recordHealth(
        organizationId,
        connectorId,
        agentId,
        frame,
      );
    if (frame.kind === "batch")
      return this.repository.stageBatch(
        organizationId,
        connectorId,
        agentId,
        frame,
      );
    const issued = await this.issueCertificate(
      { agentId, organizationId, connectorId },
      frame.csrPem,
    );
    const result = await this.repository.rotate(
      organizationId,
      connectorId,
      agentId,
      frame.idempotencyKey,
      frame.csrPem,
      issued,
    );
    return {
      kind: "rotate" as const,
      clientCertificatePem: result.clientCertificatePem,
      caCertificatePem: result.caCertificatePem,
      signingKey: result.signingKey,
      signingKeyId: result.signingKeyId,
      expiresAt: result.expiresAt,
    };
  }
}
