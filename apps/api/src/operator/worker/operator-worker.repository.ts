import { z } from "zod";
import { readBoundedJson } from "../operator-read-bounds";
import type { OperatorRegistryPublication } from "@repo/contracts";
import { operatorRegistryPublicationSchema } from "@repo/contracts";
import type { ObservationPublisher } from "../operator-collector";
/** Separate worker credential; never imported by the operator listener. */
export class OperatorWorkerRepository implements ObservationPublisher {
  private readonly origin: string;
  constructor(
    url: string,
    private readonly credential: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      )
    )
      throw new Error("Invalid worker database endpoint");
    z.object({ role: z.literal("service_role") })
      .passthrough()
      .parse(
        JSON.parse(
          Buffer.from(credential.split(".")[1] ?? "", "base64url").toString(
            "utf8",
          ),
        ),
      );
    this.origin = endpoint.origin;
  }
  private async rpc(
    name:
      | "m15_03_observe_instance"
      | "m15_03_publish_observation"
      | "m15_03_record_poll_outcome",
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      const response = await this.fetcher(
        `${this.origin}/rest/v1/rpc/${name}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(3000),
          headers: {
            apikey: this.credential,
            Authorization: `Bearer ${this.credential}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      if (!response.ok) throw new Error("Worker RPC failed");
      return await readBoundedJson(response, 256 * 1024);
    } catch {
      throw new Error("Operator worker storage unavailable");
    }
  }
  observe(
    instanceId: string,
    observedAt: string,
    afterId: string | null,
  ): Promise<unknown> {
    return this.rpc("m15_03_observe_instance", {
      p_instance_id: instanceId,
      p_observed_at: observedAt,
      p_after_id: afterId,
      p_limit: 100,
    });
  }
  async publish(
    instanceId: string,
    publication: OperatorRegistryPublication,
  ): Promise<void> {
    const result = await this.rpc("m15_03_publish_observation", {
      p_expected_instance_id: instanceId,
      p_observation: operatorRegistryPublicationSchema.parse(publication),
    });
    if (
      !z
        .strictObject({ outcome: z.enum(["published", "replayed"]) })
        .safeParse(result).success
    )
      throw new Error("Operator publication rejected");
  }
  async failure(
    instanceId: string,
    attemptedAt: string,
    reason: "collection_unreachable",
  ): Promise<void> {
    await this.rpc("m15_03_record_poll_outcome", {
      p_instance_id: instanceId,
      p_attempted_at: attemptedAt,
      p_reason: reason,
    });
  }
}
