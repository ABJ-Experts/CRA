import { ConnectorSyncWorker } from "./connector-sync-worker";
import { AesGcmConnectorVault } from "../infrastructure/connector-vault";
import type { ConnectorCredentialReaderPort } from "../application/connector-vault.port";
import { ReferenceConformanceAdapter } from "../reference-adapter/reference-conformance-adapter";

const connectorContext = {
  connector: {
    connectorType: "reference_conformance",
    connectionConfig: {},
    hasSecret: true,
    enabled: true,
    archivedAt: null,
  },
  connectionRevision: 2,
  credentialRevision: 1,
  secret: {
    secretId: "secret-a",
    credentialRevision: 1,
    legacy: false,
    envelope: null,
  },
};
const claim = {
  id: "run-a",
  organizationId: "org-a",
  connectorId: "connector-a",
  workKind: "dry_run",
  actorId: "actor-a",
  commitActorId: "approver-a",
  connectionRevision: 2,
  credentialRevision: 1,
  permissionVersion: 4,
  cursorFrom: null,
  fetchContentHash: "hash",
  correlationId: "correlation",
  leaseGeneration: 2,
  fieldMappingSnapshot: [],
  fieldMappingRevision: 0,
  schemaSnapshot: null,
  authoritySnapshot: [],
  replaySourceMode: null,
  replaySourceRecords: [],
};

export function secureWorker(
  overrides: Record<string, unknown> = {},
  credentialReader?: ConnectorCredentialReaderPort,
  egress: { validate: jest.Mock } | null = {
    validate: jest.fn().mockResolvedValue(undefined),
  },
) {
  const vault = new AesGcmConnectorVault(
    JSON.stringify({
      activeKeyId: "key",
      keys: { key: Buffer.alloc(32, 1).toString("base64") },
    }),
  );
  const envelope = vault.encrypt(
    {
      orgId: "org-a",
      connectorId: "connector-a",
      secretId: "secret-a",
      credentialRevision: 1,
    },
    "worker-canary",
  );
  const context = {
    ...connectorContext,
    secret: { ...connectorContext.secret, envelope },
  };
  const authorization = {
    authorize: jest
      .fn()
      .mockImplementation((_organizationId: string, actorId: string) =>
        Promise.resolve({
          organizationId: "org-a",
          actorId,
          role: "owner",
          permissionVersion: 4,
        }),
      ),
  };
  const hub = { context: jest.fn().mockResolvedValue(context) };
  const repository = {
    listDueSyncRunOrganizations: jest
      .fn()
      .mockResolvedValue([{ organization_id: "org-a" }]),
    claimSyncRun: jest
      .fn()
      .mockResolvedValueOnce({ ...claim, ...overrides })
      .mockResolvedValue(null),
    failSyncRun: jest.fn().mockResolvedValue(undefined),
    commitSyncRun: jest.fn().mockResolvedValue({ outcome: "completed" }),
    saveSyncRunPlan: jest.fn().mockResolvedValue(undefined),
    renewSyncRunLease: jest.fn().mockResolvedValue(true),
    resolveWorkerActor: jest.fn(),
    resolveConnectorSecret: jest.fn(),
  };
  const adapter = {
    discoverCapabilities: jest
      .fn()
      .mockImplementation(() =>
        new ReferenceConformanceAdapter().discoverCapabilities(),
      ),
    testConnection: jest.fn().mockResolvedValue({
      outcome: "success",
      latencyMs: 1,
      adapterVersion: "1.0.0",
    }),
    pull: jest.fn().mockResolvedValue({
      records: [],
      nextCursor: null,
      adapterSignal: "ok",
    }),
  };
  const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
  const from = jest.fn((table: string) => {
    const result = {
      data:
        table === "field_authority_policies"
          ? {
              id: "policy",
              policy_value: "external_authoritative",
              protected: false,
              policy_version: 1,
            }
          : table === "products" || table === "product_relationships"
            ? []
            : null,
      error: null,
    };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "neq", "like", "limit"])
      query[method] = jest.fn().mockReturnValue(query);
    query.maybeSingle = jest.fn().mockResolvedValue(result);
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return query;
  });
  const worker = new ConnectorSyncWorker(
    repository as never,
    { admin: () => ({ rpc, from }) } as never,
    new Map([["reference_conformance", adapter as never]]),
    "legacy-key",
    "worker-a",
    60,
    {
      vault,
      credentialReader,
      egress: egress ?? undefined,
      authorization,
      hub: hub as never,
    },
  );
  return {
    worker,
    repository,
    adapter,
    authorization,
    hub,
    context,
    rpc,
    egress,
  };
}
