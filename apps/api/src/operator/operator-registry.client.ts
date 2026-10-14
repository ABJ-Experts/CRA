import { ServiceUnavailableException } from "@nestjs/common";
import { readBoundedJson } from "./operator-read-bounds";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  operatorTenantIds,
  type OperatorIdentity,
} from "./domain/operator-grants";
import type {
  RegistryReadKind,
  RegistryReader,
} from "./application/operator-registry.port";
export type {
  RegistryReadKind,
  RegistryReader,
} from "./application/operator-registry.port";

/** No generic query/table access exists on the ingress database adapter. */
export class NarrowRegistryClient implements RegistryReader {
  private readonly rpcUrl: string;
  constructor(
    url: string,
    private readonly credential: string,
    private readonly projectApiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const target = new URL(url);
    if (
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      (target.protocol !== "https:" &&
        !(
          target.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
        ))
    )
      throw new Error("Invalid operator database endpoint");
    const payload = z
      .object({ role: z.literal("cra_operator_registry_reader") })
      .passthrough();
    payload.parse(
      JSON.parse(
        Buffer.from(credential.split(".")[1] ?? "", "base64url").toString(
          "utf8",
        ),
      ),
    );
    if (!projectApiKey.startsWith("sb_publishable_"))
      z.object({ role: z.literal("anon") })
        .passthrough()
        .parse(
          JSON.parse(
            Buffer.from(
              projectApiKey.split(".")[1] ?? "",
              "base64url",
            ).toString("utf8"),
          ),
        );
    this.rpcUrl = `${target.origin}/rest/v1/rpc/m15_03_operator_read`;
  }
  async read(
    identity: OperatorIdentity,
    kind: RegistryReadKind,
    instanceId: string | null,
    afterId: string | null,
    limit: number,
  ): Promise<unknown> {
    try {
      const response = await this.fetcher(this.rpcUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(1000),
        headers: {
          apikey: this.projectApiKey,
          Authorization: `Bearer ${this.credential}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_operator_id: identity.principalId,
          p_request_id: randomUUID(),
          p_instance_ids: identity.instanceIds,
          p_tenant_ids: operatorTenantIds(identity, instanceId),
          p_kind: kind,
          p_instance_id: instanceId,
          p_after_id: afterId,
          p_limit: limit,
        }),
      });
      if (!response.ok) throw new Error("Registry read failed");
      return await readBoundedJson(response, 256 * 1024);
    } catch {
      throw new ServiceUnavailableException("Operator registry unavailable");
    }
  }
}
