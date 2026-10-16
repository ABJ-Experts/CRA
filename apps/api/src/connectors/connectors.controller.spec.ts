import { NotFoundException } from "@nestjs/common";
import { PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of } from "rxjs";
import type { ExecutionContext } from "@nestjs/common";
import {
  ZOD_RESPONSE_SCHEMA,
  ZodResponseContractError,
  ZodResponseInterceptor,
} from "../common/http/zod-response.interceptor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";

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

    const input = { expectedVersion: 1, idempotencyKey: runId };
    await expect(
      controller.test({ connectorId }, input, user),
    ).resolves.toEqual({
      connector: { id: connectorId },
    });

    expect(connectors.testConnection).toHaveBeenCalledWith({
      organizationId,
      connectorId,
      actorId,
      input,
    });
  });

  it("keeps the catalogue authenticated and credentials owner-scoped", () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler("catalogue"))).toBe(
      "catalogue",
    );
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler("catalogue")),
    ).toEqual(["can_view_connectors"]);
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, handler("revokeSecret"))).toBe(
      "owner",
    );
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler("disconnect")),
    ).toEqual(["can_edit_connectors"]);
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
    await expect(
      controller.retry({ connectorId, syncRunId: runId }, {}, user),
    ).rejects.toMatchObject({ response: { code: "preview_required" } });
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
    expect(connectors.repository.retrySyncRun).not.toHaveBeenCalled();
    expect(connectors.repository.diagnosticsExport).toHaveBeenCalledWith(
      organizationId,
      connectorId,
    );
    expect(previewDigest).toHaveLength(64);
  });
});

describe("ConnectorsController trust boundaries", () => {
  const params = {
    connectorId,
    syncRunId: runId,
    mappingId: runId,
    conflictId: runId,
  };
  const pagination = { page: 2, pageSize: 20, order: "desc" as const };
  const command = {
    expectedVersion: 7,
    idempotencyKey: runId,
    reason: "Operator request",
  };
  const policy = {
    entityType: "product",
    fieldName: "name",
    policyValue: "external_authoritative",
    protected: false,
    previewDigest: "a".repeat(64),
  };
  const marker = Object.freeze({ trustedResult: true });
  const repoNames = [
    "listConnectors",
    "getConnector",
    "archiveConnector",
    "listFieldAuthorityPolicies",
    "previewFieldAuthorityPolicy",
    "upsertFieldAuthorityPolicy",
    "listExternalIdentities",
    "linkExternalIdentity",
    "unlinkExternalIdentity",
    "mergeExternalIdentities",
    "listSyncRuns",
    "getSyncRun",
    "listSyncRunPlanItems",
    "cancelSyncRun",
    "retrySyncRun",
    "listConflictsForRun",
    "getConflict",
    "resolveConflict",
    "listDeadLetters",
    "metricsSnapshot",
    "diagnosticsExport",
  ] as const;
  const hubNames = [
    "overviews",
    "overview",
    "create",
    "configure",
    "replaceSecret",
    "revokeSecret",
    "disconnect",
    "reconnect",
    "beginSync",
    "requestCommit",
  ] as const;
  function boundaryFixture() {
    const repository = Object.fromEntries(
      repoNames.map((name) => [name, jest.fn().mockResolvedValue(marker)]),
    );
    const hub = Object.fromEntries(
      hubNames.map((name) => [name, jest.fn().mockResolvedValue(marker)]),
    );
    const service = {
      repository,
      hub,
      run: jest.fn(async <T>(pending: Promise<T>) => pending),
      testConnection: jest.fn().mockResolvedValue(marker),
    };
    return { service, controller: new ConnectorsController(service as never) };
  }
  type Scenario = {
    name: keyof ConnectorsController;
    target: "repository" | "hub" | "service";
    method: string;
    invoke: (
      controller: ConnectorsController,
      identity: RequestUser,
    ) => Promise<unknown>;
    args: unknown[];
    envelope: string | null;
  };
  const rpc = {
    p_organization_id: organizationId,
    p_connector_id: connectorId,
    p_actor_user_id: actorId,
  };
  const policyRpc = {
    ...rpc,
    p_entity_type: "product",
    p_field_name: "name",
    p_policy_value: "external_authoritative",
    p_protected: false,
    p_protected_reason: null,
  };
  const cases: Scenario[] = [
    {
      name: "overviews",
      target: "hub",
      method: "overviews",
      invoke: (c, u) => c.overviews(pagination, u),
      args: [organizationId, pagination],
      envelope: "connectors",
    },
    {
      name: "overview",
      target: "hub",
      method: "overview",
      invoke: (c, u) => c.overview(params, u),
      args: [organizationId, connectorId],
      envelope: "overview",
    },
    {
      name: "list",
      target: "repository",
      method: "listConnectors",
      invoke: (c, u) => c.list(pagination, u),
      args: [organizationId, pagination],
      envelope: "connectors",
    },
    {
      name: "get",
      target: "repository",
      method: "getConnector",
      invoke: (c, u) => c.get(params, u),
      args: [organizationId, connectorId],
      envelope: "connector",
    },
    {
      name: "create",
      target: "hub",
      method: "create",
      invoke: (c, u) => c.create(command as never, u),
      args: [organizationId, actorId, command],
      envelope: "connector",
    },
    ...(
      [
        ["update", "configure"],
        ["setSecret", "replaceSecret"],
        ["revokeSecret", "revokeSecret"],
        ["disconnect", "disconnect"],
        ["reconnect", "reconnect"],
      ] as const
    ).map(([name, method]) => ({
      name,
      target: "hub" as const,
      method,
      invoke: (c: ConnectorsController, u: RequestUser) =>
        c[name](params, command as never, u),
      args: [organizationId, connectorId, actorId, command],
      envelope: "connector",
    })),
    {
      name: "test",
      target: "service",
      method: "testConnection",
      invoke: (c, u) => c.test(params, command, u),
      args: [{ organizationId, connectorId, actorId, input: command }],
      envelope: "connector",
    },
    {
      name: "archive",
      target: "repository",
      method: "archiveConnector",
      invoke: (c, u) => c.archive(params, command, u),
      args: [{ ...rpc, p_expected_version: 7, p_reason: command.reason }],
      envelope: "connector",
    },
    {
      name: "mapping",
      target: "repository",
      method: "listFieldAuthorityPolicies",
      invoke: (c, u) => c.mapping(params, u),
      args: [organizationId, actorId, connectorId],
      envelope: "policies",
    },
    {
      name: "previewPolicy",
      target: "repository",
      method: "previewFieldAuthorityPolicy",
      invoke: (c, u) => c.previewPolicy(params, policy as never, u),
      args: [policyRpc],
      envelope: "preview",
    },
    {
      name: "upsertPolicy",
      target: "repository",
      method: "upsertFieldAuthorityPolicy",
      invoke: (c, u) => c.upsertPolicy(params, policy as never, u),
      args: [{ ...policyRpc, p_preview_digest: policy.previewDigest }],
      envelope: "policy",
    },
    {
      name: "identities",
      target: "repository",
      method: "listExternalIdentities",
      invoke: (c, u) => c.identities(params, pagination, u),
      args: [organizationId, connectorId, pagination],
      envelope: "identities",
    },
    {
      name: "link",
      target: "repository",
      method: "linkExternalIdentity",
      invoke: (c, u) =>
        c.link(
          params,
          {
            entityType: "product",
            externalId: "external-1",
            craProductId: runId,
            matchMethod: "manual",
          } as never,
          u,
        ),
      args: [
        {
          ...rpc,
          p_entity_type: "product",
          p_external_id: "external-1",
          p_external_display_label: null,
          p_cra_product_id: runId,
          p_cra_release_id: null,
          p_match_method: "manual",
        },
      ],
      envelope: "mapping",
    },
    {
      name: "unlink",
      target: "repository",
      method: "unlinkExternalIdentity",
      invoke: (c, u) => c.unlink(params, { reason: command.reason }, u),
      args: [organizationId, connectorId, runId, actorId, command.reason],
      envelope: "outcome",
    },
    {
      name: "merge",
      target: "repository",
      method: "mergeExternalIdentities",
      invoke: (c, u) =>
        c.merge(
          params,
          {
            keepMappingId: runId,
            mergeFromMappingId: actorId,
            reason: command.reason,
          },
          u,
        ),
      args: [
        organizationId,
        connectorId,
        runId,
        actorId,
        actorId,
        command.reason,
      ],
      envelope: "outcome",
    },
    {
      name: "beginRun",
      target: "hub",
      method: "beginSync",
      invoke: (c, u) => c.beginRun(params, command as never, u),
      args: [organizationId, connectorId, actorId, command],
      envelope: "run",
    },
    {
      name: "listRuns",
      target: "repository",
      method: "listSyncRuns",
      invoke: (c, u) =>
        c.listRuns(params, { ...pagination, status: "completed" }, u),
      args: [organizationId, connectorId, pagination, "completed"],
      envelope: "runs",
    },
    {
      name: "getRun",
      target: "repository",
      method: "getSyncRun",
      invoke: (c, u) => c.getRun(params, u),
      args: [organizationId, connectorId, runId],
      envelope: "run",
    },
    {
      name: "planItems",
      target: "repository",
      method: "listSyncRunPlanItems",
      invoke: (c, u) => c.planItems(params, pagination, u),
      args: [organizationId, connectorId, runId, pagination],
      envelope: "planItems",
    },
    {
      name: "requestCommit",
      target: "hub",
      method: "requestCommit",
      invoke: (c, u) => c.requestCommit(params, {}, u),
      args: [organizationId, connectorId, runId, actorId, null],
      envelope: "run",
    },
    {
      name: "cancel",
      target: "repository",
      method: "cancelSyncRun",
      invoke: (c, u) => c.cancel(params, {}, u),
      args: [organizationId, connectorId, runId, actorId, null],
      envelope: "run",
    },
    {
      name: "runConflicts",
      target: "repository",
      method: "listConflictsForRun",
      invoke: (c, u) => c.runConflicts(params, u),
      args: [organizationId, connectorId, runId],
      envelope: "conflicts",
    },
    {
      name: "getConflict",
      target: "repository",
      method: "getConflict",
      invoke: (c, u) => c.getConflict(params, u),
      args: [organizationId, runId],
      envelope: "conflict",
    },
    {
      name: "resolveConflict",
      target: "repository",
      method: "resolveConflict",
      invoke: (c, u) =>
        c.resolveConflict(
          params,
          {
            expectedVersion: 7,
            chosenAction: "keep_cra",
            idempotencyKey: runId,
            reason: command.reason,
          },
          u,
        ),
      args: [
        {
          p_organization_id: organizationId,
          p_conflict_id: runId,
          p_actor_user_id: actorId,
          p_expected_version: 7,
          p_chosen_action: "keep_cra",
          p_manual_value: null,
          p_reason: command.reason,
          p_correlation_id: expect.any(String) as unknown,
        },
      ],
      envelope: "conflict",
    },
    {
      name: "deadLetters",
      target: "repository",
      method: "listDeadLetters",
      invoke: (c, u) => c.deadLetters(params, pagination, u),
      args: [organizationId, connectorId, pagination],
      envelope: "runs",
    },
    {
      name: "metrics",
      target: "repository",
      method: "metricsSnapshot",
      invoke: (c, u) => c.metrics(params, u),
      args: [organizationId],
      envelope: "metrics",
    },
    {
      name: "exportDiagnostics",
      target: "repository",
      method: "diagnosticsExport",
      invoke: (c, u) => c.exportDiagnostics(params, {}, u),
      args: [organizationId, connectorId],
      envelope: null,
    },
  ];
  it.each(cases)(
    "$name forwards trusted scope and returns its declared envelope",
    async (scenario) => {
      const { controller, service } = boundaryFixture();
      const result = await scenario.invoke(controller, user);
      const target =
        scenario.target === "service" ? service : service[scenario.target];
      expect(
        (target as Record<string, unknown>)[scenario.method],
      ).toHaveBeenCalledWith(...scenario.args);
      expect(result).toEqual(
        scenario.envelope ? { [scenario.envelope]: marker } : marker,
      );
      const expectedPermission = ["create", "beginRun"].includes(scenario.name)
        ? "can_create_connectors"
        : ["requestCommit", "resolveConflict"].includes(scenario.name)
          ? "can_approve_connectors"
          : scenario.name === "archive"
            ? "can_delete_connectors"
            : scenario.name === "exportDiagnostics"
              ? "can_export_connectors"
              : [
                    "update",
                    "setSecret",
                    "test",
                    "revokeSecret",
                    "disconnect",
                    "reconnect",
                    "previewPolicy",
                    "upsertPolicy",
                    "link",
                    "unlink",
                    "merge",
                    "cancel",
                    "retry",
                  ].includes(scenario.name)
                ? "can_edit_connectors"
                : "can_view_connectors";
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler(scenario.name)),
      ).toEqual([expectedPermission]);
      expect(
        Reflect.getMetadata(REQUIRE_ROLE_KEY, handler(scenario.name)),
      ).toBe(
        ["setSecret", "revokeSecret", "previewPolicy", "upsertPolicy"].includes(
          scenario.name,
        )
          ? "owner"
          : undefined,
      );
      expect(
        Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, handler(scenario.name)),
      ).toBeDefined();
      if (scenario.name === "metrics")
        expect(service.repository.getConnector).toHaveBeenCalledWith(
          organizationId,
          connectorId,
        );
    },
  );
  it.each(cases)(
    "$name rejects an absent tenant before any adapter effect",
    async (scenario) => {
      const { controller, service } = boundaryFixture();
      await expect(
        scenario.invoke(controller, { ...user, organizationId: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
      for (const mock of [
        ...Object.values(service.repository),
        ...Object.values(service.hub),
        service.testConnection,
      ])
        expect(mock).not.toHaveBeenCalled();
    },
  );
  it("covers explicit optional values and does not replace defined falsy values", async () => {
    const { controller, service } = boundaryFixture();
    await controller.previewPolicy(
      params,
      { ...policy, protectedReason: "Protected" } as never,
      user,
    );
    await controller.upsertPolicy(
      params,
      { ...policy, protectedReason: "Protected" } as never,
      user,
    );
    await controller.link(
      params,
      {
        entityType: "release",
        externalId: "release",
        externalDisplayLabel: "Release",
        craProductId: actorId,
        craReleaseId: runId,
        matchMethod: "manual",
      } as never,
      user,
    );
    await controller.requestCommit(params, { expectedRowCount: 0 }, user);
    await controller.cancel(params, { reason: "Canceled" }, user);
    await controller.resolveConflict(
      params,
      {
        expectedVersion: 7,
        chosenAction: "enter_manual_value",
        idempotencyKey: runId,
        manualValue: false,
        reason: "Manual",
      },
      user,
    );
    expect(service.repository.previewFieldAuthorityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ p_protected_reason: "Protected" }),
    );
    expect(service.repository.upsertFieldAuthorityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ p_protected_reason: "Protected" }),
    );
    expect(service.repository.linkExternalIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        p_external_display_label: "Release",
        p_cra_release_id: runId,
      }),
    );
    expect(service.hub.requestCommit).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      runId,
      actorId,
      0,
    );
    expect(service.repository.cancelSyncRun).toHaveBeenCalledWith(
      organizationId,
      connectorId,
      runId,
      actorId,
      "Canceled",
    );
    expect(service.repository.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ p_manual_value: false }),
    );
  });
  it("uses installed Nest body parsers to reject missing command metadata and malformed paths", () => {
    for (const name of [
      "update",
      "setSecret",
      "test",
      "revokeSecret",
      "disconnect",
      "reconnect",
    ] as const) {
      const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        ConnectorsController,
        name,
      ) as Record<string, { pipes: unknown[] }>;
      const bodyParser = Object.entries(metadata)
        .find(([key]) => key.startsWith("3:"))?.[1]
        .pipes.find((pipe) => pipe instanceof ZodValidationPipe);
      expect(bodyParser).toBeInstanceOf(ZodValidationPipe);
      expect(() =>
        (bodyParser as ZodValidationPipe<never>).transform({
          secret: "secret-canary",
        }),
      ).toThrow();
      const paramParser = Object.entries(metadata)
        .find(([key]) => key.startsWith("5:"))?.[1]
        .pipes.find((pipe) => pipe instanceof ZodValidationPipe);
      expect(() =>
        (paramParser as ZodValidationPipe<never>).transform({
          connectorId: "tenant-substitution",
        }),
      ).toThrow();
    }
  });
  it("validates successful catalogue output and rejects malformed secret-bearing responses", async () => {
    const { controller } = boundaryFixture();
    const interceptor = new ZodResponseInterceptor(new Reflector());
    const context = (name: keyof ConnectorsController) =>
      ({
        getHandler: () => handler(name),
        getClass: () => ConnectorsController,
      }) as ExecutionContext;
    await expect(
      firstValueFrom(
        interceptor.intercept(context("catalogue"), {
          handle: () => of(controller.catalogue()),
        }),
      ),
    ).resolves.toEqual(controller.catalogue());
    await expect(
      firstValueFrom(
        interceptor.intercept(context("setSecret"), {
          handle: () =>
            of({ connector: { id: connectorId, secret: "secret-canary" } }),
        }),
      ),
    ).rejects.toBeInstanceOf(ZodResponseContractError);
  });
});
