import { execFile } from "node:child_process";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  X509Certificate,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Request } from "express";
import { agentFrameBodySchema } from "@repo/contracts/connectors/schemas";
import { signFrame } from "../agent-trust/verify-agent-frame";
import { AgentCertificateAuthority } from "./agent-certificate-authority";
import { AgentIngressUseCases } from "./agent-ingress.use-cases";
import type { SupabaseAgentRepository } from "./supabase-agent.repository";

const run = promisify(execFile);
const ids = {
  agentId: "f2cb5e61-9478-49fb-89de-96b653273425",
  organizationId: "ace5f442-6b7f-4c35-b81d-b65930d9c157",
  connectorId: "1450c6ee-2607-4f66-83d5-e19bd5a159ab",
};
const signingKey = "test-agent-signing-key-with-enough-randomness";
const signingKeyId = "test-key";
const path = "/api/v1/agent/frames";

describe("agent ingress security boundary", () => {
  let directory: string;
  let certificate: X509Certificate;
  let ca: AgentCertificateAuthority;
  const repository = {
    findAgent: jest.fn(),
    signingKey: jest.fn(),
    consumeNonce: jest.fn(),
    recordHealth: jest.fn(),
    stageBatch: jest.fn(),
    rotate: jest.fn(),
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cra-agent-frame-test-"));
    const key = () =>
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export(
        { type: "pkcs8", format: "pem" },
      );
    await writeFile(join(directory, "ca.key"), key(), { mode: 0o600 });
    await writeFile(join(directory, "agent.key"), key(), { mode: 0o600 });
    await run("openssl", [
      "req",
      "-x509",
      "-new",
      "-key",
      join(directory, "ca.key"),
      "-out",
      join(directory, "ca.pem"),
      "-days",
      "2",
      "-subj",
      "/CN=CRA test agent CA",
    ]);
    await run("openssl", [
      "req",
      "-new",
      "-key",
      join(directory, "agent.key"),
      "-out",
      join(directory, "agent.csr"),
      "-subj",
      "/CN=Agent",
    ]);
    ca = new AgentCertificateAuthority(
      join(directory, "ca.pem"),
      join(directory, "ca.key"),
    );
    certificate = new X509Certificate(
      (
        await ca.issue(
          ids,
          await readFile(join(directory, "agent.csr"), "utf8"),
        )
      ).clientCertificatePem,
    );
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  beforeEach(() => {
    jest.resetAllMocks();
    repository.findAgent.mockResolvedValue({ status: "active" });
    repository.signingKey.mockReturnValue({
      key: signingKey,
      issuedAt: new Date().toISOString(),
    });
    repository.consumeNonce.mockResolvedValue(true);
    repository.recordHealth.mockResolvedValue({
      kind: "heartbeat",
      acceptedAt: new Date().toISOString(),
    });
  });
  const service = () =>
    new AgentIngressUseCases(
      repository as unknown as SupabaseAgentRepository,
      ca,
    );
  const heartbeat = () => ({
    version: 1 as const,
    kind: "heartbeat" as const,
    ...ids,
    agentVersion: "1.0.0",
    capabilities: ["canonical_file" as const],
    backlogCount: 0,
    backlogBytes: 0,
    safeErrorCode: null,
  });
  function request(
    frame: { agentId: string } = heartbeat(),
    options: { authorized?: boolean; signature?: string } = {},
  ) {
    const body = JSON.stringify(frame);
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(24).toString("base64url");
    const headers: Record<string, string> = {
      "x-cra-agent-id": frame.agentId,
      "x-cra-key-id": signingKeyId,
      "x-cra-timestamp": timestamp,
      "x-cra-nonce": nonce,
      "x-cra-signature":
        options.signature ??
        signFrame(
          { signingKey },
          { timestamp, nonce, body, method: "POST", path },
        ),
    };
    return {
      rawBody: Buffer.from(body),
      method: "POST",
      originalUrl: path,
      headers: {
        "content-type": "application/json",
        "x-forwarded-client-cert": certificate.toString(),
      },
      header(name: string) {
        return headers[name.toLowerCase()];
      },
      socket: {
        authorized: options.authorized ?? true,
        getPeerCertificate: () => ({ raw: certificate.raw }),
      },
    } as unknown as Request & { rawBody: Buffer };
  }

  it("accepts only a signed, certificate-bound heartbeat", async () => {
    const frame = heartbeat();
    const result = await service().acceptFrame(
      request(frame),
      agentFrameBodySchema.parse(frame),
    );
    expect(result.kind).toBe("heartbeat");
    expect(repository.consumeNonce).toHaveBeenCalledTimes(1);
    expect(repository.recordHealth).toHaveBeenCalledTimes(1);
  });
  it("rejects a proxy-supplied certificate when TLS has no authorized peer", async () => {
    const frame = heartbeat();
    await expect(
      service().acceptFrame(
        request(frame, { authorized: false }),
        agentFrameBodySchema.parse(frame),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.findAgent).not.toHaveBeenCalled();
  });
  it("rejects a forged frame before consuming a nonce or recording health", async () => {
    const frame = heartbeat();
    await expect(
      service().acceptFrame(
        request(frame, { signature: "a".repeat(64) }),
        agentFrameBodySchema.parse(frame),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.consumeNonce).not.toHaveBeenCalled();
    expect(repository.recordHealth).not.toHaveBeenCalled();
  });
  it("rejects a different tenant despite a valid HMAC", async () => {
    const frame = { ...heartbeat(), organizationId: randomUUID() };
    await expect(
      service().acceptFrame(request(frame), agentFrameBodySchema.parse(frame)),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.findAgent).not.toHaveBeenCalled();
  });
  it("rejects a replay before the business operation", async () => {
    repository.consumeNonce.mockResolvedValue(false);
    const frame = heartbeat();
    await expect(
      service().acceptFrame(request(frame), agentFrameBodySchema.parse(frame)),
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.recordHealth).not.toHaveBeenCalled();
  });
  it("reports malformed certificate requests without persisting enrollment", async () => {
    const scopedRepository = {
      ...repository,
      findEnrollment: jest.fn().mockResolvedValue({
        id: ids.agentId,
        organization_id: ids.organizationId,
        connector_id: ids.connectorId,
        enrollment_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      redeemEnrollment: jest.fn(),
    };
    const useCases = new AgentIngressUseCases(
      scopedRepository as unknown as SupabaseAgentRepository,
      ca,
    );
    await expect(
      useCases.enroll({
        token: "t".repeat(32),
        csrPem:
          "-----BEGIN CERTIFICATE REQUEST-----\ninvalid\n-----END CERTIFICATE REQUEST-----",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(scopedRepository.redeemEnrollment).not.toHaveBeenCalled();
  });

  it("rejects missing or expired enrollment before signing a certificate", async () => {
    const findEnrollment = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: ids.agentId,
        organization_id: ids.organizationId,
        connector_id: ids.connectorId,
        enrollment_expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
    const redeemEnrollment = jest.fn();
    const useCases = new AgentIngressUseCases(
      {
        findEnrollment,
        redeemEnrollment,
      } as unknown as SupabaseAgentRepository,
      ca,
    );
    const input = {
      token: "t".repeat(32),
      csrPem: await readFile(join(directory, "agent.csr"), "utf8"),
    };
    await expect(useCases.enroll(input)).rejects.toMatchObject({ status: 410 });
    await expect(useCases.enroll(input)).rejects.toMatchObject({ status: 410 });
    expect(redeemEnrollment).not.toHaveBeenCalled();
  });

  it("returns a parsed enrollment credential after CSR validation", async () => {
    const csrPem = await readFile(join(directory, "agent.csr"), "utf8");
    const scopedRepository = {
      findEnrollment: jest.fn().mockResolvedValue({
        id: ids.agentId,
        organization_id: ids.organizationId,
        connector_id: ids.connectorId,
        enrollment_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      redeemEnrollment: jest.fn().mockImplementation(
        (
          _token: string,
          _csr: string,
          issued: {
            clientCertificatePem: string;
            caCertificatePem: string;
            expiresAt: string;
          },
        ) => ({
          ...ids,
          clientCertificatePem: issued.clientCertificatePem,
          caCertificatePem: issued.caCertificatePem,
          signingKey: randomBytes(32).toString("base64url"),
          signingKeyId: "test-key",
          expiresAt: issued.expiresAt,
        }),
      ),
    };
    const useCases = new AgentIngressUseCases(
      scopedRepository as unknown as SupabaseAgentRepository,
      ca,
    );
    const response = await useCases.enroll({ token: "t".repeat(32), csrPem });
    expect(response.clientCertificatePem).toContain("BEGIN CERTIFICATE");
    const redeemed = scopedRepository.redeemEnrollment.mock
      .calls[0] as unknown as [string, string, { fingerprint: string }];
    expect(redeemed[0]).toBe("t".repeat(32));
    expect(redeemed[1]).toBe(csrPem);
    expect(redeemed[2].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unsupported encoding, route changes, malformed bodies and headers before data access", async () => {
    const frame = heartbeat();
    const parsed = agentFrameBodySchema.parse(frame);
    const cases: Array<
      [string, (value: ReturnType<typeof request>) => void, number]
    > = [
      [
        "content type",
        (value) => {
          value.headers["content-type"] = "text/plain";
        },
        415,
      ],
      [
        "encoding",
        (value) => {
          value.headers["content-encoding"] = "gzip";
        },
        415,
      ],
      [
        "missing raw body",
        (value) => {
          value.rawBody = undefined as unknown as Buffer;
        },
        413,
      ],
      [
        "too large",
        (value) => {
          value.rawBody = Buffer.alloc(4 * 1024 * 1024 + 1);
        },
        413,
      ],
      [
        "invalid UTF8",
        (value) => {
          value.rawBody = Buffer.from([0xff]);
        },
        400,
      ],
      [
        "changed route",
        (value) => {
          value.originalUrl = "/api/v1/agent/other";
        },
        401,
      ],
      [
        "invalid headers",
        (value) => {
          value.header = () => undefined;
        },
        401,
      ],
      [
        "invalid JSON",
        (value) => {
          value.rawBody = Buffer.from("{");
        },
        400,
      ],
    ];
    for (const [, mutate, status] of cases) {
      const value = request(frame);
      mutate(value);
      await expect(service().acceptFrame(value, parsed)).rejects.toMatchObject({
        status,
      });
      expect(repository.findAgent).not.toHaveBeenCalled();
      jest.clearAllMocks();
    }
  });

  it("rejects an unknown agent or a mismatched signing credential", async () => {
    const frame = heartbeat();
    repository.findAgent.mockResolvedValueOnce(null);
    await expect(
      service().acceptFrame(request(frame), agentFrameBodySchema.parse(frame)),
    ).rejects.toMatchObject({ status: 401 });
    repository.signingKey.mockReturnValueOnce(null);
    await expect(
      service().acceptFrame(request(frame), agentFrameBodySchema.parse(frame)),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.consumeNonce).not.toHaveBeenCalled();
  });

  it("rejects a parsed frame that differs from the signed raw identity", async () => {
    const frame = heartbeat();
    const substituted = agentFrameBodySchema.parse({
      ...frame,
      connectorId: randomUUID(),
    });
    await expect(
      service().acceptFrame(request(frame), substituted),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.recordHealth).not.toHaveBeenCalled();
  });

  it("accepts a signed batch and calls only the staging RPC", async () => {
    const batchId = randomUUID();
    const batch = agentFrameBodySchema.parse({
      version: 1,
      ...ids,
      kind: "batch",
      batchId,
      sequence: 1,
      sourceId: "file",
      cursorFrom: null,
      cursorTo: "line:1",
      records: [
        {
          entityType: "product",
          externalId: "P-1",
          externalDisplayLabel: "P 1",
          externalUpdatedAt: new Date().toISOString(),
          changeKind: "upsert",
          tombstoneReliability: "unknown",
          parentExternalId: null,
          fields: { name: "P 1" },
        },
      ],
      backlogCount: 0,
      backlogBytes: 0,
    });
    repository.stageBatch.mockResolvedValue({
      kind: "batch",
      batchId,
      sequence: 1,
      acceptedAt: new Date().toISOString(),
    });
    const result = await service().acceptFrame(request(batch), batch);
    expect(result.kind).toBe("batch");
    expect(repository.stageBatch).toHaveBeenCalledWith(
      ids.organizationId,
      ids.connectorId,
      ids.agentId,
      batch,
    );
    expect(repository.recordHealth).not.toHaveBeenCalled();
  });

  it("rotates with a signed CSR frame and returns only the new credential", async () => {
    const csrPem = await readFile(join(directory, "agent.csr"), "utf8");
    const idempotencyKey = randomUUID();
    const frame = agentFrameBodySchema.parse({
      version: 1,
      ...ids,
      kind: "rotate",
      csrPem,
      idempotencyKey,
    });
    repository.rotate.mockImplementation(async () => ({
      clientCertificatePem: certificate.toString(),
      caCertificatePem: await readFile(join(directory, "ca.pem"), "utf8"),
      signingKey: randomBytes(32).toString("base64url"),
      signingKeyId: "new-key",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    const result = await service().acceptFrame(request(frame), frame);
    expect(result.kind).toBe("rotate");
    const rotated = repository.rotate.mock.calls[0] as unknown as [
      string,
      string,
      string,
      string,
      string,
      { clientCertificatePem: string },
    ];
    expect(rotated.slice(0, 5)).toEqual([
      ids.organizationId,
      ids.connectorId,
      ids.agentId,
      idempotencyKey,
      csrPem,
    ]);
    expect(rotated[5].clientCertificatePem).toContain("BEGIN CERTIFICATE");
  });
});
