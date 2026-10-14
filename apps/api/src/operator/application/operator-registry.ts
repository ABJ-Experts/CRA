import {
  OperatorScopeError,
  OperatorCursorError,
} from "../domain/operator-errors";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  operatorInstanceResponseSchema,
  operatorInstancesResponseSchema,
  operatorTenantsResponseSchema,
  operatorInstanceMetadataResponseSchema,
} from "@repo/contracts";
import {
  operatorTenantIds,
  type OperatorIdentity,
} from "../domain/operator-grants";
import type {
  RegistryReadKind,
  RegistryReader,
} from "./operator-registry.port";
const cursorSchema = z
  .object({ scope: z.string().regex(/^[a-f0-9]{64}$/), afterId: z.uuid() })
  .strict();
const scope = (
  identity: OperatorIdentity,
  kind: RegistryReadKind,
  instanceId: string | null,
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        identity.principalId,
        identity.revision,
        [...identity.instanceIds].sort(),
        identity.tenantScopes
          .map((scope) => [scope.instanceId, [...scope.tenantIds].sort()])
          .sort((first, second) =>
            String(first[0]).localeCompare(String(second[0])),
          ),
        kind,
        instanceId,
      ]),
    )
    .digest("hex");
export function registryKeyId(value: string): string {
  const id = /^[a-f0-9]{32}$/i.test(value)
    ? value.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
    : value;
  return z.uuid().parse(id);
}
export function scopedCursor(
  identity: OperatorIdentity,
  kind: RegistryReadKind,
  instanceId: string | null,
  afterId: string,
): string {
  return Buffer.from(
    JSON.stringify({
      scope: scope(identity, kind, instanceId),
      afterId: registryKeyId(afterId),
    }),
  ).toString("base64url");
}
export class OperatorRegistry {
  constructor(private readonly reader: RegistryReader) {}
  static decodeCursor(
    cursor: string,
    identity: OperatorIdentity,
    kind: RegistryReadKind,
    instanceId: string | null,
  ): string {
    try {
      const parsed = cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
      );
      if (parsed.scope !== scope(identity, kind, instanceId))
        throw new Error("scope changed");
      return parsed.afterId;
    } catch {
      throw new OperatorCursorError("Invalid operator cursor");
    }
  }
  private assertInstance(identity: OperatorIdentity, instanceId: string): void {
    if (!identity.instanceIds.includes(instanceId))
      throw new OperatorScopeError("Operator instance unavailable");
  }
  async list(
    identity: OperatorIdentity,
    query: { cursor?: string; limit: number },
  ) {
    const data = operatorInstancesResponseSchema.parse(
      await this.reader.read(
        identity,
        "instances",
        null,
        query.cursor
          ? OperatorRegistry.decodeCursor(
              query.cursor,
              identity,
              "instances",
              null,
            )
          : null,
        query.limit,
      ),
    );
    if (
      data.instances.some(
        (item) => !identity.instanceIds.includes(item.instanceId),
      )
    )
      throw new Error("Registry scope violation");
    return {
      ...data,
      nextCursor: data.nextCursor
        ? scopedCursor(identity, "instances", null, data.nextCursor)
        : null,
    };
  }
  async detail(identity: OperatorIdentity, instanceId: string) {
    this.assertInstance(identity, instanceId);
    const data = operatorInstanceResponseSchema.parse(
      await this.reader.read(identity, "detail", instanceId, null, 1),
    );
    if (data.instance.instanceId !== instanceId)
      throw new Error("Registry scope violation");
    return data;
  }
  async tenants(
    identity: OperatorIdentity,
    instanceId: string,
    query: { cursor?: string; limit: number },
  ) {
    this.assertInstance(identity, instanceId);
    const data = operatorTenantsResponseSchema.parse(
      await this.reader.read(
        identity,
        "tenants",
        instanceId,
        query.cursor
          ? OperatorRegistry.decodeCursor(
              query.cursor,
              identity,
              "tenants",
              instanceId,
            )
          : null,
        query.limit,
      ),
    );
    if (
      data.instanceId !== instanceId ||
      data.tenants.some(
        (item) =>
          !operatorTenantIds(identity, instanceId).includes(item.tenantId),
      )
    )
      throw new Error("Registry scope violation");
    return {
      ...data,
      nextCursor: data.nextCursor
        ? scopedCursor(identity, "tenants", instanceId, data.nextCursor)
        : null,
    };
  }
  async metadata(
    identity: OperatorIdentity,
    instanceId: string,
    query: { cursor?: string; limit: number },
  ) {
    this.assertInstance(identity, instanceId);
    const data = operatorInstanceMetadataResponseSchema.parse(
      await this.reader.read(
        identity,
        "instance_metadata",
        instanceId,
        query.cursor
          ? OperatorRegistry.decodeCursor(
              query.cursor,
              identity,
              "instance_metadata",
              instanceId,
            )
          : null,
        query.limit,
      ),
    );
    if (
      data.instanceId !== instanceId ||
      data.instance.instanceId !== instanceId ||
      data.tenants.some(
        (item) =>
          !operatorTenantIds(identity, instanceId).includes(item.tenantId),
      )
    )
      throw new Error("Registry scope violation");
    return {
      ...data,
      nextCursor: data.nextCursor
        ? scopedCursor(
            identity,
            "instance_metadata",
            instanceId,
            data.nextCursor,
          )
        : null,
    };
  }
}
