import { randomUUID } from "node:crypto";
import { siemCredentialSchema } from "@repo/contracts/audit/schemas";
import { siemCatalogue } from "../domain/siem-policy";
import {
  siemFingerprintKeySchema,
  siemTestContextSchema,
} from "./siem-provider.schemas";
import {
  SiemCredentialInvalidError,
  type SiemVaultPort,
} from "./siem-vault.port";
import type { SiemTransportPort } from "./siem-transport.port";
import type { RequestUser } from "../../../auth/auth.types";
import type { AuditExplorerRepository } from "../../application/audit-explorer.port";
import {
  SiemForbiddenError,
  SiemInputError,
  SiemUnavailableError,
} from "../siem.errors";
import type { SiemOperation, SiemRepositoryPort } from "./siem-repository.port";
const reads: readonly SiemOperation[] = [
  "catalogue",
  "list",
  "get",
  "deliveries",
  "delivery",
];
const credentials: readonly SiemOperation[] = [
  "rotate_credentials",
  "revoke_credentials",
];
export class SiemUseCases {
  constructor(
    private readonly repository: SiemRepositoryPort,
    private readonly permissions: Pick<
      AuditExplorerRepository,
      "effectivePermissions"
    >,
    private readonly vault?: SiemVaultPort,
    private readonly transport?: SiemTransportPort,
  ) {}
  async execute(
    user: RequestUser,
    operation: SiemOperation,
    destinationId: string | null,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (!user.isActive || !user.organizationId || !user.role)
      throw new SiemForbiddenError();
    const { permissions } = await this.permissions
      .effectivePermissions(user.organizationId, user.id, user.role)
      .catch(() => {
        throw new SiemUnavailableError();
      });
    if (!permissions.can_view_audit || !permissions.can_view_connectors)
      throw new SiemForbiddenError();
    if (!reads.includes(operation)) {
      if (
        !permissions.can_export_audit ||
        !(operation === "create"
          ? permissions.can_create_connectors
          : permissions.can_edit_connectors)
      )
        throw new SiemForbiddenError();
      if (credentials.includes(operation) && user.role !== "owner")
        throw new SiemForbiddenError();
    }
    if (operation === "catalogue") {
      await this.repository.command(
        user.organizationId,
        user.id,
        operation,
        null,
        input,
      );
      return siemCatalogue();
    }
    if (operation === "test")
      return this.test(user.organizationId, user.id, destinationId!, input);
    if (reads.includes(operation) || operation === "replay_preview")
      return this.repository.command(
        user.organizationId,
        user.id,
        operation,
        destinationId,
        input,
      );
    // Containment has no credential input and must remain usable during key outages.
    // The RPC uses its normalized SHA-256 digest consistently across vault recovery.
    if (operation === "disable" || operation === "revoke_credentials")
      return this.repository.command(
        user.organizationId,
        user.id,
        operation,
        destinationId,
        { ...input, keyId: null },
      );
    if (!this.vault?.available()) throw new SiemUnavailableError();
    if ((operation === "create" || operation === "update") && this.transport)
      await this.transport
        .validate(
          input.transport as "https" | "syslog_tls",
          input.endpoint as string,
        )
        .catch(() => {
          throw new SiemInputError();
        });
    const previous = siemFingerprintKeySchema.parse(
      await this.repository.command(
        user.organizationId,
        user.id,
        "fingerprint_key",
        destinationId,
        input,
      ),
    );
    const fingerprint = this.fingerprint(
      user.organizationId,
      destinationId!,
      canonical(input),
      previous.keyId ?? undefined,
    );
    let stored = input;
    if (operation === "rotate_credentials") {
      const credential = siemCredentialSchema.parse(input.credential);
      const credentialId = randomUUID();
      const credentialRevision = Number(input.expectedVersion) + 1;
      const encryptedCredential = this.encrypt(
        {
          orgId: user.organizationId,
          destinationId: destinationId!,
          credentialId,
          credentialRevision,
        },
        credential,
      );
      const { credential: discarded, ...publicInput } = input;
      void discarded;
      stored = {
        ...publicInput,
        encryptedCredential,
        credentialId,
        credentialRevision,
      };
    }
    return this.repository.command(
      user.organizationId,
      user.id,
      operation,
      destinationId,
      {
        ...stored,
        operationDigest: fingerprint.digest,
        keyId: fingerprint.keyId,
      },
    );
  }
  private fingerprint(
    orgId: string,
    destinationId: string,
    input: string,
    keyId?: string,
  ) {
    try {
      return this.vault!.fingerprint(orgId, destinationId, input, keyId);
    } catch {
      throw new SiemUnavailableError();
    }
  }
  private encrypt(
    context: import("./siem-vault.port").SiemVaultContext,
    credential: import("@repo/contracts/audit/types").SiemCredential,
  ) {
    try {
      return this.vault!.encrypt(context, credential);
    } catch (error) {
      if (error instanceof SiemCredentialInvalidError)
        throw new SiemInputError();
      throw new SiemUnavailableError();
    }
  }
  private decrypt(
    context: import("./siem-vault.port").SiemVaultContext,
    envelope: import("../../../connectors/application/connector-vault.port").ConnectorSecretEnvelope,
  ) {
    try {
      return this.vault!.decrypt(context, envelope);
    } catch {
      throw new SiemUnavailableError();
    }
  }

  private async test(
    orgId: string,
    actorId: string,
    destinationId: string,
    input: Readonly<Record<string, unknown>>,
  ) {
    if (!this.vault?.available() || !this.transport)
      throw new SiemUnavailableError();
    const prior = siemFingerprintKeySchema.parse(
      await this.repository.command(
        orgId,
        actorId,
        "fingerprint_key",
        destinationId,
        input,
      ),
    );
    const fingerprint = this.fingerprint(
      orgId,
      destinationId,
      canonical(input),
      prior.keyId ?? undefined,
    );
    const testInput = {
      ...input,
      operationDigest: fingerprint.digest,
      keyId: fingerprint.keyId,
    };
    const prepared = (await this.repository.command(
      orgId,
      actorId,
      "test_prepare",
      destinationId,
      testInput,
    )) as Record<string, unknown>;
    if (prepared.completed === true) return prepared.result;
    const context = siemTestContextSchema.parse(prepared);
    const credential = this.decrypt(
      {
        orgId,
        destinationId,
        credentialId: context.credentialId,
        credentialRevision: context.credentialRevision,
      },
      context.credentials,
    );
    const result = await this.transport.send({
      protocol: context.transport,
      endpoint: context.endpoint,
      format: context.format,
      body: Buffer.from(
        context.format === "json"
          ? JSON.stringify({
              schemaVersion: 1,
              type: "cra_siem_connection_test",
              eventId: input.requestId,
            })
          : "CEF:0|ABJ Experts|CRA Sentinel|1|connection_test|Connection test|0|",
      ),
      eventId: String(input.requestId),
      credential,
      beforeSend: async () => {
        const fresh = siemTestContextSchema.parse(
          await this.repository.command(
            orgId,
            actorId,
            "test_prepare",
            destinationId,
            testInput,
          ),
        );
        return (
          fresh.credentialId === context.credentialId &&
          fresh.credentialRevision === context.credentialRevision &&
          fresh.endpoint === context.endpoint &&
          fresh.format === context.format
        );
      },
    });
    return this.repository.command(orgId, actorId, "test", destinationId, {
      ...testInput,
      state: result.outcome,
      safeFailureCode: result.code,
    });
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
