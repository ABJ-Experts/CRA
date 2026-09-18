import { PATH_METADATA } from "@nestjs/common/constants";

import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type RequestUser,
} from "../auth/auth.types";
import { ConnectorsController } from "./connectors.controller";

const organizationId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const user: RequestUser = Object.freeze({
  id: actorId,
  authUserId: "00000000-0000-4000-8000-000000000005",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
});

function handler(name: keyof ConnectorsController): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    ConnectorsController.prototype,
    name,
  )?.value;
  if (typeof value !== "function") throw new Error(`Missing ${String(name)}`);
  return value;
}

function fixture() {
  const repository = {
    previewFieldAuthorityPolicy: jest.fn().mockResolvedValue({}),
    retrySyncRun: jest.fn().mockResolvedValue({}),
    diagnosticsExport: jest.fn().mockResolvedValue({}),
  };
  const connectors = {
    repository,
    run: jest.fn(async <T>(pending: Promise<T>) => pending),
    testConnection: jest.fn().mockResolvedValue({ id: connectorId }),
  };
  return {
    connectors,
    controller: new ConnectorsController(connectors as never),
  };
}

describe("ConnectorsController route contracts", () => {
  it("uses the exact operational methods and privileges for preview, retry, and safe diagnostics", () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler("previewPolicy"))).toBe(
      ":connectorId/mapping/preview",
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler("retry"))).toBe(
      ":connectorId/sync-runs/:syncRunId/retry",
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, handler("exportDiagnostics")),
    ).toBe(":connectorId/diagnostics/export");
    expect(
      Reflect.getMetadata(REQUIRE_ROLE_KEY, handler("previewPolicy")),
    ).toBe("owner");
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler("previewPolicy")),
    ).toEqual(["can_edit_connectors"]);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler("retry")),
    ).toEqual(["can_edit_connectors"]);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        handler("exportDiagnostics"),
      ),
    ).toEqual(["can_export_connectors"]);
  });

  it("tests a connection only through the server-side port service", async () => {
    const { controller, connectors } = fixture();

    await expect(controller.test({ connectorId }, {}, user)).resolves.toEqual({
      connector: { id: connectorId },
    });

    expect(connectors.testConnection).toHaveBeenCalledWith({
      organizationId,
      connectorId,
      actorId,
    });
  });

  it("forwards only guard-owned tenant and actor identity to preview, retry, and diagnostics", async () => {
    const { controller, connectors } = fixture();
    const previewDigest = "a".repeat(64);

    await controller.previewPolicy(
      { connectorId },
      {
        entityType: "product",
        fieldName: "name",
        policyValue: "external_authoritative",
        protected: false,
      },
      user,
    );
    await controller.retry({ connectorId, syncRunId: runId }, {}, user);
    await controller.exportDiagnostics({ connectorId }, {}, user);

    expect(
      connectors.repository.previewFieldAuthorityPolicy,
    ).toHaveBeenCalledWith({
      p_organization_id: organizationId,
      p_connector_id: connectorId,
      p_actor_user_id: actorId,
      p_entity_type: "product",
      p_field_name: "name",
      p_policy_value: "external_authoritative",
      p_protected: false,
      p_protected_reason: null,
    });
    expect(connectors.repository.retrySyncRun).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      runId,
      actorId,
    );
    expect(connectors.repository.diagnosticsExport).toHaveBeenCalledWith(
      organizationId,
      connectorId,
    );
    expect(previewDigest).toHaveLength(64);
  });
});
