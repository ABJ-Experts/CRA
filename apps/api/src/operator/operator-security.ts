import { UnauthorizedException } from "@nestjs/common";
import { readBoundedFile } from "./operator-read-bounds";
import { isIP } from "node:net";
import { z } from "zod";

import { grantsSchema, type OperatorIdentity } from "./domain/operator-grants";
export type { OperatorIdentity } from "./domain/operator-grants";

/** Mounted grants are deliberately read for each request, including keepalive. */
export class OperatorGrantStore {
  constructor(readonly path: string) {}
  async read(): Promise<z.output<typeof grantsSchema>> {
    const data = await readBoundedFile(this.path, 1024 * 1024);
    return grantsSchema.parse(JSON.parse(data.toString("utf8")));
  }
}

type PeerSocket = {
  encrypted?: boolean;
  authorized?: boolean;
  getPeerCertificate?: () => {
    fingerprint256?: string;
    valid_from?: string;
    valid_to?: string;
  };
};
export async function authorizeOperatorSocket(
  socket: PeerSocket,
  store: OperatorGrantStore,
  now = Date.now(),
): Promise<OperatorIdentity> {
  const deny = () => new UnauthorizedException("Operator certificate denied");
  if (
    socket.encrypted !== true ||
    socket.authorized !== true ||
    !socket.getPeerCertificate
  )
    throw deny();
  const certificate = socket.getPeerCertificate();
  const from = Date.parse(certificate.valid_from ?? "");
  const to = Date.parse(certificate.valid_to ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || now < from || now >= to)
    throw deny();
  const config = await store.read();
  const grant = config.grants.find(
    (item) => item.fingerprint256 === certificate.fingerprint256,
  );
  if (!grant) throw deny();
  return {
    ...grant,
    instanceIds: [...grant.instanceIds],
    tenantScopes: grant.tenantScopes.map((scope) => ({
      ...scope,
      tenantIds: [...scope.tenantIds],
    })),
    revision: config.revision,
  };
}

export function privateAddress(host: string): boolean {
  if (isIP(host) === 6)
    return host === "::1" || /^f[cd][0-9a-f]{2}:/i.test(host);
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split(".").map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  );
}
