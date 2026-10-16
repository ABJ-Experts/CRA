import { NotFoundException } from "@nestjs/common";
import { PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import { ZOD_RESPONSE_SCHEMA } from "../common/http/zod-response.interceptor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ConnectorsSyncOperationsController } from "./connectors-sync-operations.controller";

const org = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const syncRunId = "00000000-0000-4000-8000-000000000003";
const user = { id: "actor", organizationId: org } as RequestUser;
const query = { page: 1, pageSize: 15 };
const input = {
  expectedVersion: 1,
  mappingMode: "preserve" as const,
  sourceMode: "retained" as const,
};
const cases = [
  {
    name: "mappingSchema",
    path: ":connectorId/field-mapping/schema",
    edit: false,
    args: [org, connectorId, user.id],
    envelope: "schema",
  },
  {
    name: "currentMapping",
    path: ":connectorId/field-mapping",
    edit: false,
    args: [org, connectorId, user.id],
    envelope: "mapping",
  },
  {
    name: "previewMapping",
    path: ":connectorId/field-mapping/preview",
    edit: true,
    args: [org, connectorId, user.id, input],
    envelope: "preview",
  },
  {
    name: "saveMapping",
    path: ":connectorId/field-mapping",
    edit: true,
    args: [org, connectorId, user.id, input],
    envelope: "mapping",
  },
  {
    name: "history",
    path: ":connectorId/sync-history",
    edit: false,
    args: [org, connectorId, user.id, query],
    envelope: "runs",
  },
  {
    name: "detail",
    path: ":connectorId/sync-runs/:syncRunId/history",
    edit: false,
    args: [org, connectorId, syncRunId, user.id, query],
    envelope: null,
  },
  {
    name: "deadLetters",
    path: ":connectorId/dead-letter-records",
    edit: false,
    args: [org, connectorId, user.id, query],
    envelope: "records",
  },
  {
    name: "replayPreview",
    path: ":connectorId/sync-runs/:syncRunId/replay/preview",
    edit: true,
    args: [org, connectorId, syncRunId, user.id, input],
    envelope: "preview",
  },
  {
    name: "replay",
    path: ":connectorId/sync-runs/:syncRunId/replay",
    edit: true,
    args: [org, connectorId, syncRunId, user.id, input],
    envelope: "run",
  },
] as const;

describe("connector sync operations controller boundaries", () => {
  it.each(cases)(
    "$name parses input, scopes identity and delegates to the use case",
    async (scenario) => {
      const marker = { safe: true };
      const operations = Object.fromEntries(
        cases.map(({ name }) => [name, jest.fn().mockResolvedValue(marker)]),
      );
      const service = {
        run: jest.fn(async <T>(pending: Promise<T>) => pending),
      };
      const controller = new ConnectorsSyncOperationsController(
        operations as never,
        service as never,
      );
      const params = { connectorId, syncRunId };
      const value =
        scenario.name === "mappingSchema" || scenario.name === "currentMapping"
          ? await controller[scenario.name](params, user)
          : scenario.name === "history" ||
              scenario.name === "deadLetters" ||
              scenario.name === "detail"
            ? await controller[scenario.name](params, query, user)
            : await controller[scenario.name](params, input as never, user);
      expect(operations[scenario.name]).toHaveBeenCalledWith(...scenario.args);
      expect(value).toEqual(
        scenario.envelope ? { [scenario.envelope]: marker } : marker,
      );
      const handler = Object.getOwnPropertyDescriptor(
        ConnectorsSyncOperationsController.prototype,
        scenario.name,
      )?.value as object;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(scenario.path);
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
        scenario.edit ? "can_edit_connectors" : "can_view_connectors",
      ]);
      expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, handler)).toBeDefined();
      const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        ConnectorsSyncOperationsController,
        scenario.name,
      ) as Record<string, { pipes?: unknown[] }>;
      const pipes = Object.values(metadata).flatMap(
        (argument) => argument.pipes ?? [],
      );
      expect(pipes.some((pipe) => pipe instanceof ZodValidationPipe)).toBe(
        true,
      );
      const param = pipes.find((pipe) => pipe instanceof ZodValidationPipe);
      if (!(param instanceof ZodValidationPipe))
        throw new Error("Missing parameter parser");
      expect(() => {
        param.transform({ connectorId: "invalid", syncRunId: "invalid" });
      }).toThrow();
    },
  );

  it.each(cases)(
    "$name rejects an absent organization before accessing the use case",
    async (scenario) => {
      const operations = Object.fromEntries(
        cases.map(({ name }) => [name, jest.fn()]),
      );
      const controller = new ConnectorsSyncOperationsController(
        operations as never,
        { run: (pending: Promise<unknown>) => pending } as never,
      );
      const identity = { ...user, organizationId: null } as RequestUser;
      const params = { connectorId, syncRunId };
      const action =
        scenario.name === "mappingSchema" || scenario.name === "currentMapping"
          ? controller[scenario.name](params, identity)
          : scenario.name === "history" ||
              scenario.name === "deadLetters" ||
              scenario.name === "detail"
            ? controller[scenario.name](params, query, identity)
            : controller[scenario.name](params, input as never, identity);
      await expect(action).rejects.toBeInstanceOf(NotFoundException);
      expect(operations[scenario.name]).not.toHaveBeenCalled();
    },
  );
});
