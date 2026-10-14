import type { OperatorIdentity } from "../domain/operator-grants";
export type RegistryReadKind =
  "instances" | "detail" | "tenants" | "instance_metadata";
export interface RegistryReader {
  read(
    identity: OperatorIdentity,
    kind: RegistryReadKind,
    instanceId: string | null,
    afterId: string | null,
    limit: number,
  ): Promise<unknown>;
}
