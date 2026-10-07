import type { ConnectorSecretEnvelope } from "../../../connectors/application/connector-vault.port";
export type SiemClaim = Readonly<{
  organizationId: string;
  deliveryId: string;
  destinationId: string;
  leaseToken: string;
  version: number;
  workerId: string;
  eventId: string;
  payloadBytes: string;
  protocol: "https" | "syslog_tls";
  endpoint: string;
  format: "json" | "cef";
  credentials: ConnectorSecretEnvelope;
  credentialId: string;
  credentialRevision: number;
}>;
export type SiemCompletion = Readonly<{
  state: "accepted" | "sent_unacknowledged" | "retry" | "failed";
  code: string | null;
  status: number | null;
  durationMs: number;
  retryAfterSeconds: number | null;
}>;
export interface SiemWorkerPort {
  stage(workerId: string): Promise<void>;
  claim(workerId: string): Promise<SiemClaim | null>;
  authorize(claim: SiemClaim): Promise<SiemClaim | null>;
  complete(claim: SiemClaim, result: SiemCompletion): Promise<void>;
}
