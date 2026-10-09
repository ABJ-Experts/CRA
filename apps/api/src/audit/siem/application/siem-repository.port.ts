export type SiemOperation =
  | "catalogue"
  | "list"
  | "get"
  | "create"
  | "update"
  | "rotate_credentials"
  | "revoke_credentials"
  | "test"
  | "enable"
  | "disable"
  | "deliveries"
  | "delivery"
  | "replay_preview"
  | "replay"
  | "denial"
  | "fingerprint_key"
  | "test_prepare";
export interface SiemRepositoryPort {
  command(
    orgId: string,
    actorId: string,
    operation: SiemOperation,
    destinationId: string | null,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}
export const SIEM_REPOSITORY = Symbol("SIEM_REPOSITORY");
