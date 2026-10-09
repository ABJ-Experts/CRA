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
import { AesGcmConnectorVault } from "../infrastructure/connector-vault";
import type { SupabaseService } from "../../supabase/supabase.service";
import { AgentCertificateAuthority } from "./agent-certificate-authority";
import {
  AgentRepositoryError,
  SupabaseAgentRepository,
} from "./supabase-agent.repository";

const orgId = "ace5f442-6b7f-4c35-b81d-b65930d9c157";
const connectorId = "1450c6ee-2607-4f66-83d5-e19bd5a159ab";
const actorId = "f2cb5e61-9478-49fb-89de-96b653273425";
const agentId = "bb833cdf-4af0-4143-8b09-15eaa720c558";
const now = "2026-10-01T00:00:00.000Z";
const run = promisify(execFile);
const vault = new AesGcmConnectorVault(
  JSON.stringify({
    activeKeyId: "test",
    keys: { test: randomBytes(32).toString("base64") },
  }),
);

function query(data: unknown, error: unknown = null) {
  const value = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    range: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
    then: (resolve: (result: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolve({ data, error })),
  };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.order.mockReturnValue(value);
  value.limit.mockReturnValue(value);
  value.range.mockReturnValue(value);
  return value;
}

function repositoryWithTables(
  tables: Record<string, ReturnType<typeof query>>,
) {
  const from = jest.fn((table: string) => tables[table]);
  const repository = new SupabaseAgentRepository(
    { admin: () => ({ from }) } as unknown as SupabaseService,
    vault,
  );
  return { repository, from };
}

describe("SupabaseAgentRepository", () => {
  let certificateFixture: Awaited<
    ReturnType<AgentCertificateAuthority["issue"]>
  >;
  let csrPem: string;
  let certificateDirectory: string;
  beforeAll(async () => {
    certificateDirectory = await mkdtemp(
      join(tmpdir(), "cra-agent-repository-test-"),
    );
    const privateKey = () =>
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export(
        { type: "pkcs8", format: "pem" },
      );
    await writeFile(join(certificateDirectory, "ca.key"), privateKey(), {
      mode: 0o600,
    });
    await writeFile(join(certificateDirectory, "agent.key"), privateKey(), {
      mode: 0o600,
    });
    await run("openssl", [
      "req",
      "-x509",
      "-new",
      "-key",
      join(certificateDirectory, "ca.key"),
      "-out",
      join(certificateDirectory, "ca.pem"),
      "-days",
      "2",
      "-subj",
      "/CN=Test CA",
    ]);
    await run("openssl", [
      "req",
      "-new",
      "-key",
      join(certificateDirectory, "agent.key"),
      "-out",
      join(certificateDirectory, "agent.csr"),
      "-subj",
      "/CN=Agent",
    ]);
    csrPem = await readFile(join(certificateDirectory, "agent.csr"), "utf8");
    certificateFixture = await new AgentCertificateAuthority(
      join(certificateDirectory, "ca.pem"),
      join(certificateDirectory, "ca.key"),
    ).issue({ agentId, organizationId: orgId, connectorId }, csrPem);
  });
  afterAll(async () => {
    await rm(certificateDirectory, { recursive: true, force: true });
  });
  it("replays the same encrypted enrollment token for the same idempotency key", async () => {
    const idempotencyKey = randomUUID();
    let firstEnvelope: unknown;
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    const rpc = jest.fn((_name: string, args: Record<string, unknown>) => {
      firstEnvelope ??= args.p_token_envelope;
      return Promise.resolve({
        error: null,
        data: [
          {
            outcome:
              firstEnvelope === args.p_token_envelope ? "issued" : "replayed",
            agent: {
              id: idempotencyKey,
              organization_id: orgId,
              connector_id: connectorId,
              status: "pending",
              enrollment_token_envelope: firstEnvelope,
              enrollment_expires_at: expiresAt,
            },
          },
        ],
      });
    });
    const supabase = { admin: () => ({ rpc }) } as unknown as SupabaseService;
    const repository = new SupabaseAgentRepository(supabase, vault);
    const first = await repository.issueEnrollment(
      orgId,
      connectorId,
      actorId,
      1,
      idempotencyKey,
    );
    const replay = await repository.issueEnrollment(
      orgId,
      connectorId,
      actorId,
      1,
      idempotencyKey,
    );
    expect(replay).toEqual(first);
    expect(first.token).toHaveLength(43);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(first.token);
  });
  it("maps the atomic nonce outcome to one winner", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ error: null, data: [{ outcome: "accepted" }] })
      .mockResolvedValueOnce({ error: null, data: [{ outcome: "replay" }] });
    const repository = new SupabaseAgentRepository(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      vault,
    );
    const args = [
      orgId,
      connectorId,
      actorId,
      "a".repeat(64),
      "key",
      randomUUID(),
    ] as const;
    expect(await repository.consumeNonce(...args)).toBe(true);
    expect(await repository.consumeNonce(...args)).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "m1106_consume_agent_nonce",
      expect.objectContaining({
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: actorId,
      }),
    );
  });
  it("fails closed when the nonce store is unavailable", async () => {
    const repository = new SupabaseAgentRepository(
      {
        admin: () => ({
          rpc: () =>
            Promise.resolve({
              data: null,
              error: { message: "DB unavailable" },
            }),
        }),
      } as unknown as SupabaseService,
      vault,
    );
    await expect(
      repository.consumeNonce(
        orgId,
        connectorId,
        actorId,
        "a".repeat(64),
        "key",
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(AgentRepositoryError);
  });

  it("fetches enrollment by hashed token without returning a secret", async () => {
    const agents = query({
      id: agentId,
      organization_id: orgId,
      connector_id: connectorId,
      status: "pending",
    });
    const { repository } = repositoryWithTables({ connector_agents: agents });
    expect(await repository.findEnrollment("opaque-token")).toMatchObject({
      id: agentId,
    });
    expect(agents.eq).toHaveBeenCalledWith(
      "enrollment_token_hash",
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(JSON.stringify(agents.eq.mock.calls)).not.toContain("opaque-token");
  });

  it("reads a credential only under organization, connector and agent scope", async () => {
    const agents = query({
      id: agentId,
      organization_id: orgId,
      connector_id: connectorId,
      status: "active",
    });
    const { repository } = repositoryWithTables({ connector_agents: agents });
    expect(
      await repository.findAgent(orgId, connectorId, agentId),
    ).toMatchObject({ status: "active" });
    expect(agents.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["organization_id", orgId],
        ["connector_id", connectorId],
        ["id", agentId],
      ]),
    );
  });

  it("keeps status bounded and redacts all credential material", async () => {
    const agents = query({
      id: agentId,
      organization_id: orgId,
      connector_id: connectorId,
      status: "active",
      last_contact_at: now,
      agent_version: "1.0.0",
      capabilities: ["canonical_file"],
      backlog_count: 3,
      backlog_bytes: 20,
      last_error_code: "source_unavailable",
    });
    const batches = query(
      Array.from({ length: 21 }, (_, index) => ({
        id: randomUUID(),
        sequence: index + 1,
        record_count: 1,
        received_at: now,
        status: "staged",
      })),
    );
    const { repository } = repositoryWithTables({
      connector_agents: agents,
      connector_agent_batches: batches,
    });
    const result = await repository.status(orgId, connectorId, "20");
    expect(result.batches.rows).toHaveLength(20);
    expect(result.batches.nextCursor).toBe("40");
    expect(result.agent).toMatchObject({ status: "active", backlogCount: 3 });
    expect(JSON.stringify(result)).not.toContain("signingKey");
    expect(batches.range).toHaveBeenCalledWith(20, 40);
    expect(agents.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["organization_id", orgId],
        ["connector_id", connectorId],
      ]),
    );
    expect(batches.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["organization_id", orgId],
        ["connector_id", connectorId],
      ]),
    );
  });

  it("rejects malformed and excessive status cursors before querying batches", async () => {
    const agents = query(null);
    const batches = query([]);
    const { repository } = repositoryWithTables({
      connector_agents: agents,
      connector_agent_batches: batches,
    });
    await expect(
      repository.status(orgId, connectorId, "-1"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      repository.status(orgId, connectorId, "100001"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(batches.range).not.toHaveBeenCalled();
  });

  it("uses fixed canonical capabilities only for an active scoped agent", async () => {
    const agents = query({ id: agentId, status: "active" });
    const { repository } = repositoryWithTables({ connector_agents: agents });
    const capabilities = await repository.agentCapabilities(orgId, connectorId);
    expect(capabilities?.entities.map((entity) => entity.entityType)).toEqual([
      "product",
      "release",
    ]);
    expect(capabilities?.entities.every((entity) => !entity.supportsPush)).toBe(
      true,
    );
    expect(agents.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["organization_id", orgId],
        ["connector_id", connectorId],
        ["status", "active"],
      ]),
    );
    agents.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      repository.agentCapabilities(orgId, connectorId),
    ).resolves.toBeNull();
  });

  it("pulls exactly the next staged sequence and rejects invalid cursors or page sizes", async () => {
    const agents = query({ id: agentId, status: "active" });
    const record = {
      entityType: "product",
      externalId: "P-1",
      externalDisplayLabel: "P 1",
      externalUpdatedAt: now,
      changeKind: "upsert",
      tombstoneReliability: "unknown",
      parentExternalId: null,
      fields: { name: "P 1" },
    };
    const batches = query({
      id: randomUUID(),
      batch_id: randomUUID(),
      sequence: 1,
      source_id: "source",
      cursor_from: null,
      cursor_to: "line:1",
      records: [record],
      record_count: 1,
      received_at: now,
      status: "staged",
    });
    const { repository } = repositoryWithTables({
      connector_agents: agents,
      connector_agent_batches: batches,
    });
    const page = await repository.pullStagedPage(orgId, connectorId, null, 1);
    expect(page).toMatchObject({
      adapterSignal: "ok",
      nextCursor: { token: "agent:1", watermark: now },
      records: [record],
    });
    expect(batches.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["organization_id", orgId],
        ["connector_id", connectorId],
        ["sequence", 1],
      ]),
    );
    expect(
      (
        await repository.pullStagedPage(
          orgId,
          connectorId,
          { token: "bad", watermark: now },
          1,
        )
      ).adapterSignal,
    ).toBe("cursor_invalid");
    expect(
      (await repository.pullStagedPage(orgId, connectorId, null, 201))
        .adapterSignal,
    ).toBe("cursor_invalid");
    expect(
      (await repository.pullStagedPage(orgId, connectorId, null, 0))
        .adapterSignal,
    ).toBe("cursor_invalid");
  });

  it("returns a stable empty page for a gap and fails closed when no agent is active", async () => {
    const agents = query({ id: agentId, status: "active" });
    const batches = query(null);
    const { repository } = repositoryWithTables({
      connector_agents: agents,
      connector_agent_batches: batches,
    });
    const cursor = { token: "agent:2", watermark: now };
    expect(
      await repository.pullStagedPage(orgId, connectorId, cursor, 200),
    ).toEqual({ records: [], nextCursor: cursor, adapterSignal: "ok" });
    agents.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(
      (await repository.pullStagedPage(orgId, connectorId, cursor, 200))
        .adapterSignal,
    ).toBe("unavailable");
  });

  it("preserves server acceptedAt across idempotent batch replay and passes bounded metadata", async () => {
    const rpc = jest.fn().mockResolvedValue({
      error: null,
      data: [{ outcome: "replayed", accepted_at: now }],
    });
    const repository = new SupabaseAgentRepository(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      vault,
    );
    const batchId = randomUUID();
    const result = await repository.stageBatch(orgId, connectorId, agentId, {
      batchId,
      sequence: 1,
      sourceId: "file",
      cursorFrom: null,
      cursorTo: "line:1",
      records: [],
      backlogCount: 2,
      backlogBytes: 100,
    });
    expect(result).toEqual({
      kind: "batch",
      batchId,
      sequence: 1,
      acceptedAt: now,
    });
    expect(rpc).toHaveBeenCalledWith(
      "m1106_stage_agent_batch",
      expect.objectContaining({
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_sequence: 1,
        p_backlog_bytes: 100,
      }),
    );
  });

  it("records health and refuses a failed database outcome", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        error: null,
        data: [{ outcome: "accepted", accepted_at: now }],
      })
      .mockResolvedValueOnce({
        error: null,
        data: [{ outcome: "revoked", accepted_at: null }],
      });
    const repository = new SupabaseAgentRepository(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      vault,
    );
    const heartbeat = {
      agentVersion: "1.0.0",
      capabilities: ["canonical_file"],
      backlogCount: 0,
      backlogBytes: 0,
      safeErrorCode: null,
    };
    expect(
      await repository.recordHealth(orgId, connectorId, agentId, heartbeat),
    ).toEqual({ kind: "heartbeat", acceptedAt: now });
    expect(rpc).toHaveBeenCalledWith(
      "m1106_record_agent_health",
      expect.objectContaining({
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
      }),
    );
    await expect(
      repository.recordHealth(orgId, connectorId, agentId, heartbeat),
    ).rejects.toMatchObject({ code: "revoked" });
  });

  it("refuses sequence conflicts and maps revocation through the durable RPC", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        error: null,
        data: [{ outcome: "sequence_gap", accepted_at: null }],
      })
      .mockResolvedValueOnce({
        error: null,
        data: [
          {
            outcome: "revoked",
            agent: {
              id: agentId,
              organization_id: orgId,
              connector_id: connectorId,
              status: "revoked",
            },
          },
        ],
      });
    const repository = new SupabaseAgentRepository(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      vault,
    );
    await expect(
      repository.stageBatch(orgId, connectorId, agentId, {
        batchId: randomUUID(),
        sequence: 2,
        sourceId: "file",
        cursorFrom: null,
        cursorTo: "line:2",
        records: [],
        backlogCount: 0,
        backlogBytes: 0,
      }),
    ).rejects.toMatchObject({ code: "sequence_gap" });
    const result = await repository.revoke(
      orgId,
      connectorId,
      agentId,
      actorId,
      7,
      randomUUID(),
    );
    expect(result.agent).toMatchObject({ id: agentId, status: "revoked" });
    expect(rpc).toHaveBeenCalledWith(
      "m1106_revoke_agent",
      expect.objectContaining({
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_permission_version: 7,
      }),
    );
  });

  it("redeems a preflighted token and returns only the newly issued credential", async () => {
    const token = randomBytes(32).toString("base64url");
    const agents = query({
      id: agentId,
      organization_id: orgId,
      connector_id: connectorId,
      status: "pending",
    });
    const rpc = jest.fn((_name: string, args: Record<string, unknown>) =>
      Promise.resolve({
        error: null,
        data: [
          {
            outcome: "enrolled",
            agent: {
              id: agentId,
              organization_id: orgId,
              connector_id: connectorId,
              status: "active",
              current_cert_pem: certificateFixture.clientCertificatePem,
              current_signing_key_id: args.p_signing_key_id,
              current_signing_key_envelope: args.p_signing_key_envelope,
              current_expires_at: certificateFixture.expiresAt,
            },
          },
        ],
      }),
    );
    const repository = new SupabaseAgentRepository(
      {
        admin: () => ({ from: () => agents, rpc }),
      } as unknown as SupabaseService,
      vault,
    );
    const response = await repository.redeemEnrollment(
      token,
      csrPem,
      certificateFixture,
    );
    expect(response).toMatchObject({
      agentId,
      organizationId: orgId,
      connectorId,
      clientCertificatePem: certificateFixture.clientCertificatePem,
      caCertificatePem: certificateFixture.caCertificatePem,
    });
    expect(response.signingKey).toHaveLength(43);
    expect(response.expiresAt).toBe(
      new Date(
        new X509Certificate(certificateFixture.clientCertificatePem).validTo,
      ).toISOString(),
    );
    const redeemed = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(redeemed[0]).toBe("m1106_redeem_agent_enrollment");
    expect(redeemed[1].p_token_hash).toEqual(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(redeemed[1].p_csr_hash).toEqual(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
  });

  it("rejects missing enrollment before generating or persisting a credential", async () => {
    const agents = query(null);
    const rpc = jest.fn();
    const repository = new SupabaseAgentRepository(
      {
        admin: () => ({ from: () => agents, rpc }),
      } as unknown as SupabaseService,
      vault,
    );
    await expect(
      repository.redeemEnrollment("invalid", csrPem, certificateFixture),
    ).rejects.toMatchObject({ code: "invalid_enrollment" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("replays rotation through the durable idempotency key and uses the earlier credential deadline", async () => {
    const deadline = new Date(Date.now() + 60_000).toISOString();
    let firstKeyId: unknown;
    let firstEnvelope: unknown;
    const rpc = jest.fn((_name: string, args: Record<string, unknown>) => {
      firstKeyId ??= args.p_signing_key_id;
      firstEnvelope ??= args.p_signing_key_envelope;
      return Promise.resolve({
        error: null,
        data: [
          {
            outcome:
              firstKeyId === args.p_signing_key_id ? "rotated" : "replayed",
            agent: {
              id: agentId,
              organization_id: orgId,
              connector_id: connectorId,
              status: "active",
              current_cert_pem: certificateFixture.clientCertificatePem,
              current_signing_key_id: firstKeyId,
              current_signing_key_envelope: firstEnvelope,
              current_expires_at: deadline,
            },
          },
        ],
      });
    });
    const repository = new SupabaseAgentRepository(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      vault,
    );
    const key = randomUUID();
    const first = await repository.rotate(
      orgId,
      connectorId,
      agentId,
      key,
      csrPem,
      certificateFixture,
    );
    const replay = await repository.rotate(
      orgId,
      connectorId,
      agentId,
      key,
      csrPem,
      certificateFixture,
    );
    expect(first).toEqual(replay);
    expect(first.expiresAt).toBe(deadline);
    expect(rpc).toHaveBeenCalledWith(
      "m1106_rotate_agent_credential",
      expect.objectContaining({
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_idempotency_key: key,
      }),
    );
  });

  it("accepts only a certificate-bound current or unexpired previous HMAC key", () => {
    const current = vault.encrypt(
      {
        orgId,
        connectorId,
        secretId: `${agentId}:hmac:current`,
        credentialRevision: 1,
      },
      "current-secret",
    );
    const previous = vault.encrypt(
      {
        orgId,
        connectorId,
        secretId: `${agentId}:hmac:previous`,
        credentialRevision: 1,
      },
      "previous-secret",
    );
    const row = {
      id: agentId,
      organization_id: orgId,
      connector_id: connectorId,
      status: "active",
      current_cert_fingerprint: "a".repeat(64),
      current_signing_key_id: "current",
      current_signing_key_envelope: current,
      current_key_issued_at: now,
      previous_cert_fingerprint: "b".repeat(64),
      previous_signing_key_id: "previous",
      previous_signing_key_envelope: previous,
      previous_key_issued_at: now,
      previous_valid_until: new Date(Date.now() + 60_000).toISOString(),
    } as Parameters<SupabaseAgentRepository["signingKey"]>[0];
    const repository = new SupabaseAgentRepository(
      {} as SupabaseService,
      vault,
    );
    expect(repository.signingKey(row, "current", "a".repeat(64))).toEqual({
      key: "current-secret",
      issuedAt: now,
    });
    expect(repository.signingKey(row, "previous", "b".repeat(64))).toEqual({
      key: "previous-secret",
      issuedAt: now,
    });
    expect(repository.signingKey(row, "previous", "a".repeat(64))).toBeNull();
    expect(
      repository.signingKey(
        { ...row, previous_valid_until: now },
        "previous",
        "b".repeat(64),
      ),
    ).toBeNull();
  });

  it("prunes expired nonce rows through the bounded maintenance RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null, data: null });
    const repository = new SupabaseAgentRepository(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      vault,
    );
    await repository.pruneExpiredNonces();
    expect(rpc).toHaveBeenCalledWith("m1106_prune_agent_nonces", {
      p_limit: 10_000,
    });
  });
});
