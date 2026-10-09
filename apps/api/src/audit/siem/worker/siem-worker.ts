import { siemEventSchema } from "@repo/contracts/audit/schemas";
import { formatSiemEvent } from "../domain/siem-policy";
import { randomUUID } from "node:crypto";
import type { SiemTransportPort } from "../application/siem-transport.port";
import type { SiemVaultPort } from "../application/siem-vault.port";
import type { SiemWorkerPort, SiemCompletion } from "./siem-worker.port";
export class SiemWorker {
  constructor(
    private readonly repository: SiemWorkerPort,
    private readonly transport: SiemTransportPort,
    private readonly vault: SiemVaultPort,
    private readonly workerId: string = randomUUID(),
  ) {}
  async runOnce(): Promise<"processed" | "paused" | "idle"> {
    await this.repository.stage(this.workerId);
    const claim = await this.repository.claim(this.workerId);
    if (!claim) return "idle";
    const authorized = await this.repository.authorize(claim);
    if (
      !authorized ||
      authorized.credentialRevision !== claim.credentialRevision ||
      authorized.credentialId !== claim.credentialId ||
      authorized.version !== claim.version
    )
      return "paused";
    let completion: SiemCompletion;
    try {
      const event = siemEventSchema.parse(JSON.parse(authorized.payloadBytes));
      if (
        event.organizationId !== claim.organizationId ||
        event.eventId !== claim.eventId
      )
        throw new Error("siem_provider_scope_mismatch");
      const credential = this.vault.decrypt(
        {
          orgId: claim.organizationId,
          destinationId: claim.destinationId,
          credentialId: claim.credentialId,
          credentialRevision: claim.credentialRevision,
        },
        authorized.credentials,
      );
      const result = await this.transport.send({
        protocol: authorized.protocol,
        endpoint: authorized.endpoint,
        format: authorized.format,
        body: Buffer.from(formatSiemEvent(event, authorized.format), "utf8"),
        eventId: authorized.eventId,
        credential,
        beforeSend: async () => {
          const fresh = await this.repository.authorize(claim);
          return Boolean(
            fresh &&
            fresh.version === claim.version &&
            fresh.credentialId === claim.credentialId &&
            fresh.credentialRevision === claim.credentialRevision,
          );
        },
      });
      completion = {
        state:
          result.outcome === "failed"
            ? result.retryable
              ? "retry"
              : "failed"
            : result.outcome,
        code: result.code,
        status: result.status,
        durationMs: result.durationMs,
        retryAfterSeconds: result.retryAfterSeconds,
      };
    } catch {
      completion = {
        state: "retry",
        code: "transport_unavailable",
        status: null,
        durationMs: 0,
        retryAfterSeconds: null,
      };
    }
    await this.repository.complete(claim, completion);
    return "processed";
  }
}
