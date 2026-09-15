import type {
  DeactivateOrganizationInput,
  DestructiveReauthenticationResponse,
  ExportAttachmentDownloadResponse,
  ExportRequestResponse,
  MfaRolloutReadiness,
  OrganizationExport,
  OrganizationLifecycle,
  OrganizationLifecycleResponse,
  OrganizationSettings,
  OrganizationSettingsCatalog,
  OrganizationSettingsResponse,
  RecoverOrganizationInput,
  RetentionPolicy,
  RetentionPolicyResponse,
  RetentionPolicyUpdateInput,
  ScheduleOrganizationPurgeInput,
  UpdateOrganizationSettingsInput,
} from "@repo/contracts/organizations";

import type { Result } from "../../../common/domain/result";
import { failure, success } from "../../../common/domain/result";

export type Found<T> =
  Readonly<{ outcome: "found"; value: T }> | Readonly<{ outcome: "not_found" }>;

export type SettingsWriteOutcome =
  | Readonly<{
      outcome: "updated";
      settings: OrganizationSettings;
      sessionPolicyTightened?: boolean;
    }>
  | Readonly<{ outcome: "conflict"; settings: OrganizationSettings }>
  | Readonly<{ outcome: "invalid_request" }>
  | Readonly<{ outcome: "not_found" }>;

export type RetentionWriteOutcome =
  | Readonly<{ outcome: "updated"; policy: RetentionPolicy }>
  | Readonly<{ outcome: "conflict"; policy: RetentionPolicy }>
  | Readonly<{ outcome: "invalid_request" }>
  | Readonly<{ outcome: "not_found" }>;

export type ExportRequestOutcome =
  | Readonly<{
      outcome: "created" | "replayed";
      export: OrganizationExport;
      idempotent: boolean;
    }>
  | Readonly<{ outcome: "conflict" }>
  | Readonly<{ outcome: "invalid_request" }>
  | Readonly<{ outcome: "not_found" }>;

export type ReauthenticationGrantOutcome =
  | Readonly<{
      outcome: "created";
      reauthenticationGrantId: string;
      expiresAt: string;
    }>
  | Readonly<{ outcome: "not_found" }>;

export type LifecycleMutationOutcome =
  | Readonly<{ outcome: "updated"; lifecycle: OrganizationLifecycle }>
  | Readonly<{
      outcome:
        | "invalid_grant"
        | "invalid_request"
        | "conflict"
        | "invalid_state"
        | "not_found";
    }>;

export interface TenantAdministrationRepository {
  getSettings(
    organizationId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; settings: OrganizationSettings }>
    | Readonly<{ outcome: "not_found" }>
  >;
  getSettingsCatalog(organizationId: string): Promise<
    | Readonly<{
        outcome: "found";
        catalog: OrganizationSettingsCatalog;
      }>
    | Readonly<{ outcome: "not_found" }>
  >;
  updateSettings(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: UpdateOrganizationSettingsInput,
  ): Promise<SettingsWriteOutcome>;
  getRetentionPolicies(
    organizationId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; policies: readonly RetentionPolicy[] }>
    | Readonly<{ outcome: "not_found" }>
  >;
  updateRetentionPolicy(
    organizationId: string,
    actorId: string,
    input: RetentionPolicyUpdateInput,
  ): Promise<RetentionWriteOutcome>;
  requestExport(
    organizationId: string,
    actorId: string,
    idempotencyKey: string,
    requestDigest: string,
    correlationId: string,
  ): Promise<ExportRequestOutcome>;
  getExport(
    organizationId: string,
    exportId: string,
  ): Promise<Found<OrganizationExport>>;
  getLatestExport(organizationId: string): Promise<OrganizationExport | null>;
  getLifecycle(
    organizationId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; lifecycle: OrganizationLifecycle }>
    | Readonly<{ outcome: "not_found" }>
  >;
  createReauthenticationGrant(
    organizationId: string,
    actorId: string,
    sessionId: string,
    lifecycleVersion: number,
    expiresAt: string,
  ): Promise<ReauthenticationGrantOutcome>;
  deactivate(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: DeactivateOrganizationInput,
  ): Promise<LifecycleMutationOutcome>;
  schedulePurge(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: ScheduleOrganizationPurgeInput,
  ): Promise<LifecycleMutationOutcome>;
  recover(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: RecoverOrganizationInput,
  ): Promise<LifecycleMutationOutcome>;
}

export interface MfaFactorReadinessPort {
  read(organizationId: string): Promise<MfaRolloutReadiness>;
}

export type DestructiveReauthenticationOutcome = Readonly<{
  outcome:
    | "verified"
    | "invalid_password"
    | "mfa_required"
    | "invalid_mfa"
    | "unavailable";
}>;

export interface DestructiveReauthenticationPort {
  verify(
    input: Readonly<{
      email: string;
      password: string;
      accessToken: string;
      actorId: string;
      mfaCode?: string;
    }>,
  ): Promise<DestructiveReauthenticationOutcome>;
}

export type ExportDownloadOutcome =
  | Readonly<{
      outcome: "available";
      download: ExportAttachmentDownloadResponse;
    }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "unavailable" }>;

export interface TenantExportDownloadPort {
  createDownload(
    organizationId: string,
    exportId: string,
    actorId: string,
  ): Promise<ExportDownloadOutcome>;
}

export interface TenantRequestIdentityPort {
  create(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ): Readonly<{ requestDigest: string; correlationId: string }>;
}

export interface TenantClockPort {
  now(): Date;
}

export const TENANT_ADMINISTRATION_REPOSITORY = Symbol(
  "TENANT_ADMINISTRATION_REPOSITORY",
);
export const MFA_FACTOR_READINESS_PORT = Symbol("MFA_FACTOR_READINESS_PORT");
export const DESTRUCTIVE_REAUTHENTICATION_PORT = Symbol(
  "DESTRUCTIVE_REAUTHENTICATION_PORT",
);
export const TENANT_EXPORT_DOWNLOAD_PORT = Symbol(
  "TENANT_EXPORT_DOWNLOAD_PORT",
);
export const TENANT_REQUEST_IDENTITY_PORT = Symbol(
  "TENANT_REQUEST_IDENTITY_PORT",
);
export const TENANT_CLOCK_PORT = Symbol("TENANT_CLOCK_PORT");

export type TenantAdministrationError = Readonly<{
  code:
    | "invalid_request"
    | "mfa_not_ready"
    | "conflict"
    | "not_found"
    | "forbidden"
    | "unavailable"
    | "malformed_provider"
    | "invalid_state"
    | "invalid_grant"
    | "mfa_required";
  current?: OrganizationSettings | RetentionPolicy;
}>;

type TenantResult<T> = Result<T, TenantAdministrationError>;

const REAUTHENTICATION_GRANT_TTL_MS = 10 * 60 * 1000;

export class TenantAdministrationProviderError extends Error {
  readonly name = "TenantAdministrationProviderError";

  constructor(readonly code: "unavailable" | "malformed") {
    super(code);
  }
}

export class TenantAdministrationUseCases {
  constructor(
    private readonly repository: TenantAdministrationRepository,
    private readonly mfaReadiness: MfaFactorReadinessPort,
    private readonly reauthentication: DestructiveReauthenticationPort,
    private readonly downloads: TenantExportDownloadPort,
    private readonly requestIdentity: TenantRequestIdentityPort,
    private readonly clock: TenantClockPort,
  ) {}

  async settings(
    organizationId: string,
  ): Promise<TenantResult<OrganizationSettingsResponse>> {
    try {
      const [stored, readiness] = await Promise.all([
        this.repository.getSettings(organizationId),
        this.mfaReadiness.read(organizationId),
      ]);
      if (stored.outcome === "not_found") return this.notFound();
      return success(
        Object.freeze({
          settings: stored.settings,
          mfaRolloutReadiness: readiness,
        }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async settingsCatalog(
    organizationId: string,
  ): Promise<TenantResult<Readonly<{ catalog: OrganizationSettingsCatalog }>>> {
    try {
      const result = await this.repository.getSettingsCatalog(organizationId);
      return result.outcome === "found"
        ? success(Object.freeze({ catalog: result.catalog }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async updateSettings(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sessionId: string;
      input: UpdateOrganizationSettingsInput;
    }>,
  ): Promise<TenantResult<OrganizationSettingsResponse>> {
    const enforcementDate = command.input.values.mfaEnforcementDate;
    if (enforcementDate !== null) {
      if (enforcementDate <= this.clock.now().toISOString().slice(0, 10)) {
        return failure(Object.freeze({ code: "invalid_request" as const }));
      }
      try {
        const readiness = await this.mfaReadiness.read(command.organizationId);
        if (!readiness.safeToEnforce) {
          return failure(Object.freeze({ code: "mfa_not_ready" as const }));
        }
      } catch (error) {
        return this.providerFailure(error);
      }
    }

    try {
      const result = await this.repository.updateSettings(
        command.organizationId,
        command.actorId,
        command.sessionId,
        command.input,
      );
      if (result.outcome === "conflict") {
        return failure(
          Object.freeze({
            code: "conflict" as const,
            current: result.settings,
          }),
        );
      }
      if (result.outcome === "invalid_request") {
        return failure(Object.freeze({ code: "invalid_request" as const }));
      }
      if (result.outcome === "not_found") return this.notFound();
      const readiness = await this.mfaReadiness.read(command.organizationId);
      return success(
        Object.freeze({
          settings: result.settings,
          mfaRolloutReadiness: readiness,
        }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async retention(
    organizationId: string,
  ): Promise<TenantResult<RetentionPolicyResponse>> {
    try {
      const result = await this.repository.getRetentionPolicies(organizationId);
      return result.outcome === "found"
        ? success(Object.freeze({ policies: [...result.policies] }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async updateRetention(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: RetentionPolicyUpdateInput;
    }>,
  ): Promise<TenantResult<RetentionPolicyResponse>> {
    try {
      const result = await this.repository.updateRetentionPolicy(
        command.organizationId,
        command.actorId,
        command.input,
      );
      if (result.outcome === "conflict") {
        return failure(
          Object.freeze({ code: "conflict" as const, current: result.policy }),
        );
      }
      if (result.outcome === "invalid_request") {
        return failure(Object.freeze({ code: "invalid_request" as const }));
      }
      if (result.outcome === "not_found") return this.notFound();
      return success(Object.freeze({ policies: [result.policy] }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async requestExport(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ): Promise<TenantResult<ExportRequestResponse>> {
    const identity = this.requestIdentity.create(command);
    try {
      const result = await this.repository.requestExport(
        command.organizationId,
        command.actorId,
        command.idempotencyKey,
        identity.requestDigest,
        identity.correlationId,
      );
      if (result.outcome === "conflict") {
        return failure(Object.freeze({ code: "conflict" as const }));
      }
      if (result.outcome === "invalid_request") {
        return failure(Object.freeze({ code: "invalid_request" as const }));
      }
      if (result.outcome === "not_found") return this.notFound();
      return success(
        Object.freeze({ export: result.export, idempotent: result.idempotent }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async exportStatus(
    command: Readonly<{
      organizationId: string;
      exportId: string;
    }>,
  ): Promise<TenantResult<Readonly<{ export: OrganizationExport }>>> {
    try {
      const result = await this.repository.getExport(
        command.organizationId,
        command.exportId,
      );
      return result.outcome === "found"
        ? success(Object.freeze({ export: result.value }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async latestExport(
    organizationId: string,
  ): Promise<TenantResult<Readonly<{ export: OrganizationExport | null }>>> {
    try {
      return success(
        Object.freeze({
          export: await this.repository.getLatestExport(organizationId),
        }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async downloadExport(
    command: Readonly<{
      organizationId: string;
      exportId: string;
      actorId: string;
    }>,
  ): Promise<TenantResult<ExportAttachmentDownloadResponse>> {
    try {
      const result = await this.downloads.createDownload(
        command.organizationId,
        command.exportId,
        command.actorId,
      );
      if (result.outcome === "not_found") return this.notFound();
      if (result.outcome === "unavailable") {
        return failure(Object.freeze({ code: "unavailable" as const }));
      }
      return success(result.download);
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async lifecycle(
    organizationId: string,
  ): Promise<TenantResult<OrganizationLifecycleResponse>> {
    try {
      const result = await this.repository.getLifecycle(organizationId);
      return result.outcome === "found"
        ? success(Object.freeze({ lifecycle: result.lifecycle }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async reauthenticate(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sessionId: string;
      email: string;
      accessToken: string;
      password: string;
      mfaCode?: string;
    }>,
  ): Promise<TenantResult<DestructiveReauthenticationResponse>> {
    try {
      const lifecycle = await this.repository.getLifecycle(
        command.organizationId,
      );
      if (lifecycle.outcome === "not_found") return this.notFound();
      const verified = await this.reauthentication.verify({
        email: command.email,
        password: command.password,
        accessToken: command.accessToken,
        actorId: command.actorId,
        ...(command.mfaCode ? { mfaCode: command.mfaCode } : {}),
      });
      if (verified.outcome !== "verified") {
        return failure(
          Object.freeze({
            code:
              verified.outcome === "mfa_required"
                ? ("mfa_required" as const)
                : verified.outcome === "unavailable"
                  ? ("unavailable" as const)
                  : ("forbidden" as const),
          }),
        );
      }
      const expiresAt = new Date(
        this.clock.now().getTime() + REAUTHENTICATION_GRANT_TTL_MS,
      ).toISOString();
      const grant = await this.repository.createReauthenticationGrant(
        command.organizationId,
        command.actorId,
        command.sessionId,
        lifecycle.lifecycle.version,
        expiresAt,
      );
      return grant.outcome === "created"
        ? success(
            Object.freeze({
              reauthenticationGrantId: grant.reauthenticationGrantId,
              expiresAt: grant.expiresAt,
            }),
          )
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async deactivate(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sessionId: string;
    }> &
      DeactivateOrganizationInput,
  ): Promise<TenantResult<OrganizationLifecycleResponse>> {
    return this.lifecycleMutation(
      this.repository.deactivate(
        command.organizationId,
        command.actorId,
        command.sessionId,
        command,
      ),
    );
  }

  async schedulePurge(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sessionId: string;
    }> &
      ScheduleOrganizationPurgeInput,
  ): Promise<TenantResult<OrganizationLifecycleResponse>> {
    return this.lifecycleMutation(
      this.repository.schedulePurge(
        command.organizationId,
        command.actorId,
        command.sessionId,
        command,
      ),
    );
  }

  async recover(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sessionId: string;
    }> &
      RecoverOrganizationInput,
  ): Promise<TenantResult<OrganizationLifecycleResponse>> {
    return this.lifecycleMutation(
      this.repository.recover(
        command.organizationId,
        command.actorId,
        command.sessionId,
        command,
      ),
    );
  }

  private async lifecycleMutation(
    pending: Promise<LifecycleMutationOutcome>,
  ): Promise<TenantResult<OrganizationLifecycleResponse>> {
    try {
      const result = await pending;
      if (result.outcome === "updated") {
        return success(Object.freeze({ lifecycle: result.lifecycle }));
      }
      const code =
        result.outcome === "not_found"
          ? "not_found"
          : result.outcome === "invalid_grant"
            ? "invalid_grant"
            : result.outcome;
      return failure(Object.freeze({ code }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private notFound<T>(): TenantResult<T> {
    return failure(Object.freeze({ code: "not_found" as const }));
  }

  private providerFailure(error: unknown): TenantResult<never> {
    return failure(
      Object.freeze({
        code:
          error instanceof TenantAdministrationProviderError &&
          error.code === "malformed"
            ? ("malformed_provider" as const)
            : ("unavailable" as const),
      }),
    );
  }
}
