import type { SiemCredential } from "@repo/contracts/audit/types";
export type { SiemCredential } from "@repo/contracts/audit/types";
export type SiemSendInput = Readonly<{
  protocol: "https" | "syslog_tls";
  endpoint: string;
  format: "json" | "cef";
  body: Buffer;
  eventId: string;
  credential: SiemCredential;
  beforeSend?: () => Promise<void | boolean>;
}>;
export type SiemTransportResult = Readonly<{
  outcome: "accepted" | "sent_unacknowledged" | "failed";
  status: number | null;
  category: string | null;
  code: string | null;
  retryable: boolean;
  retryAfterSeconds: number | null;
  durationMs: number;
  responseBytes: 0;
}>;
export interface SiemTransportPort {
  validate(
    protocol: SiemSendInput["protocol"],
    endpoint: string,
  ): Promise<void>;
  send(input: SiemSendInput): Promise<SiemTransportResult>;
}
