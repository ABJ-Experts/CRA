import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { PermissionsService } from "../permissions/permissions.service";
import { SupabaseService } from "../supabase/supabase.service";
import { ConnectorHubUseCases } from "./application/connector-hub-use-cases";
import { ConnectorSyncOperationsUseCases } from "./application/connector-sync-operations-use-cases";
import { ConnectorsSyncOperationsController } from "./connectors-sync-operations.controller";
import { ConnectorError } from "./application/connector-errors";
import { ConnectorVaultUnavailableError } from "./application/connector-vault.port";
import type {
  ConnectorPort,
  ConnectorType,
} from "./application/connector-port";
import { CONNECTOR_PORTS, ConnectorsModule } from "./connectors.module";
import { ConnectorsService } from "./connectors.service";
import { ConnectorAuthorizationAdapter } from "./infrastructure/connector-authorization.adapter";
import { ConnectorCredentialReader } from "./infrastructure/connector-vault-reader";
import { AesGcmConnectorVault } from "./infrastructure/connector-vault";
import { NodeConnectorEgressPolicy } from "./infrastructure/node-connector-egress.policy";
import { SupabaseConnectorHubRepository } from "./infrastructure/supabase-connector-hub.repository";
import { SupabaseConnectorRepository } from "./infrastructure/supabase-connector.repository";
import { ReferenceConformanceAdapter } from "./reference-adapter/reference-conformance-adapter";
import { AgentBackedAdapter } from "./agent-adapter/agent-backed-adapter";
import { ConnectorSyncWorker } from "./worker/connector-sync-worker";

const variables = [
  "CONNECTOR_VAULT_KEYRING",
  "CONNECTOR_SECRET_ENCRYPTION_KEY",
  "CONNECTOR_VAULT_GPG_BINARY",
  "CONNECTOR_ALLOWED_HOSTS",
] as const;
const original = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
const configuredKeyring = JSON.stringify({
  activeKeyId: "module-fixture",
  keys: { "module-fixture": randomBytes(32).toString("base64") },
});
const context = Object.freeze({
  orgId: "org-fixture",
  connectorId: "connector-fixture",
  secretId: "secret-fixture",
  credentialRevision: 1,
});

describe("ConnectorsModule production composition", () => {
  afterEach(() => {
    for (const name of variables) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    jest.restoreAllMocks();
  });
  it.each([
    {
      name: "external GCM keyring and legacy bridge",
      keyring: configuredKeyring,
      legacy: "module-legacy-fixture",
      hosts: "approved.example,,",
      available: true,
    },
    {
      name: "missing vault and bridge configuration",
      keyring: undefined,
      legacy: undefined,
      hosts: undefined,
      available: false,
    },
    {
      name: "malformed keyring without legacy bridge",
      keyring: "malformed-json",
      legacy: undefined,
      hosts: "approved.example",
      available: false,
    },
  ])(
    "compiles $name without touching storage, and retains API/worker security ports",
    async (scenario) => {
      for (const name of variables) delete process.env[name];
      if (scenario.keyring !== undefined)
        process.env.CONNECTOR_VAULT_KEYRING = scenario.keyring;
      if (scenario.legacy !== undefined) {
        process.env.CONNECTOR_SECRET_ENCRYPTION_KEY = scenario.legacy;
        process.env.CONNECTOR_VAULT_GPG_BINARY = "module-fixture-gpg";
      }
      if (scenario.hosts !== undefined)
        process.env.CONNECTOR_ALLOWED_HOSTS = scenario.hosts;
      const supabase = {
        admin: jest.fn(() => {
          throw new Error("Unexpected storage access during composition");
        }),
      };
      const permissions = { effectivePermissions: jest.fn() };
      const module = await Test.createTestingModule({
        imports: [ConnectorsModule],
      })
        .overrideProvider(SupabaseService)
        .useValue(supabase)
        .overrideProvider(PermissionsService)
        .useValue(permissions)
        .compile();
      try {
        const service = module.get(ConnectorsService);
        expect(module.get(ConnectorSyncOperationsUseCases)).toBeInstanceOf(
          ConnectorSyncOperationsUseCases,
        );
        expect(module.get(ConnectorsSyncOperationsController)).toBeInstanceOf(
          ConnectorsSyncOperationsController,
        );
        const hub = module.get(ConnectorHubUseCases);
        expect(service.hub).toBe(hub);
        const adapters =
          module.get<ReadonlyMap<ConnectorType, ConnectorPort>>(
            CONNECTOR_PORTS,
          );
        expect([...adapters.keys()]).toEqual([
          "reference_conformance",
          "on_prem_agent",
        ]);
        expect(adapters.get("reference_conformance")).toBeInstanceOf(
          ReferenceConformanceAdapter,
        );
        expect(adapters.get("on_prem_agent")).toBeInstanceOf(
          AgentBackedAdapter,
        );
        expect(supabase.admin).not.toHaveBeenCalled();
        const vault = module.get(AesGcmConnectorVault);
        const reader = module.get(ConnectorCredentialReader);
        expect(vault.available()).toBe(scenario.available);
        if (scenario.available) {
          const envelope = vault.encrypt(context, "module-secret-canary");
          await expect(
            reader.read(context, { legacy: false, envelope }),
          ).resolves.toBe("module-secret-canary");
        } else
          expect(() => vault.encrypt(context, "module-secret-canary")).toThrow(
            ConnectorVaultUnavailableError,
          );
        await expect(
          reader.read(context, { legacy: true, envelope: null }),
        ).rejects.toThrow(ConnectorVaultUnavailableError);
        await expect(
          module
            .get(NodeConnectorEgressPolicy)
            .validate({ baseUrl: "https://not-approved.example/" }),
        ).rejects.toBeInstanceOf(ConnectorError);
        const authorization = module.get(ConnectorAuthorizationAdapter);
        const deny = jest
          .spyOn(authorization, "authorize")
          .mockRejectedValue(new ConnectorError("forbidden_by_policy"));
        const hubRepository = module.get(SupabaseConnectorHubRepository);
        const hubContext = jest.spyOn(hubRepository, "context");
        const repository = module.get(SupabaseConnectorRepository);
        jest
          .spyOn(repository, "listDueSyncRunOrganizations")
          .mockResolvedValue([{ organization_id: context.orgId }]);
        jest
          .spyOn(repository, "claimSyncRun")
          .mockResolvedValueOnce({
            id: "run-fixture",
            organizationId: context.orgId,
            connectorId: context.connectorId,
            workKind: "dry_run",
            actorId: "original-actor",
            commitActorId: null,
            connectionRevision: 1,
            credentialRevision: 1,
            permissionVersion: 1,
            leaseGeneration: 1,
            fieldMappingSnapshot: [],
            fieldMappingRevision: 0,
            schemaSnapshot: null,
            replaySourceMode: null,
            replaySourceRecords: [],
            cursorFrom: null,
            fetchContentHash: null,
            correlationId: null,
          })
          .mockResolvedValue(null);
        const fail = jest
          .spyOn(repository, "failSyncRun")
          .mockResolvedValue({});
        const adapter = adapters.get("reference_conformance")!;
        const test = jest.spyOn(adapter, "testConnection");
        const pull = jest.spyOn(adapter, "pull");
        jest
          .spyOn(Logger.prototype, "warn")
          .mockImplementation(() => undefined);
        await module.get(ConnectorSyncWorker).runOnce();
        expect(deny).toHaveBeenCalledWith(context.orgId, "original-actor", [
          "can_create_connectors",
          "can_view_products",
        ]);
        expect(fail).toHaveBeenCalledWith(
          context.orgId,
          "run-fixture",
          expect.stringMatching(/^connector-sync-/),
          "authorization_changed",
          1,
          false,
          null,
        );
        expect(hubContext).not.toHaveBeenCalled();
        expect(test).not.toHaveBeenCalled();
        expect(pull).not.toHaveBeenCalled();
        expect(supabase.admin).not.toHaveBeenCalled();
      } finally {
        await module.close();
      }
    },
  );
});
