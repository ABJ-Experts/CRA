import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { Result } from "../common/domain/result";
import {
  SbomIntakeUseCases,
  type SbomIntakeError,
} from "./application/sbom-intake-use-cases";
import { SbomNormalizationUseCases } from "./application/sbom-normalization-use-cases";
import { SbomQualityUseCases } from "./application/sbom-quality-use-cases";
import {
  SBOM_CI_CREDENTIALS,
  type SbomCiCredentialPort,
} from "./application/sbom-ci-credential.port";
import { Inject } from "@nestjs/common";

@Injectable()
export class SbomService {
  constructor(
    private readonly useCases: SbomIntakeUseCases,
    private readonly normalization: SbomNormalizationUseCases,
    private readonly quality: SbomQualityUseCases,
    @Inject(SBOM_CI_CREDENTIALS)
    private readonly credentials: SbomCiCredentialPort,
  ) {}

  initialize(command: Parameters<SbomIntakeUseCases["initialize"]>[0]) {
    return this.unwrap(this.useCases.initialize(command));
  }

  complete(command: Parameters<SbomIntakeUseCases["complete"]>[0]) {
    return this.unwrap(this.useCases.complete(command));
  }

  job(organizationId: string, actorId: string, jobId: string) {
    return this.unwrap(this.useCases.job(organizationId, actorId, jobId));
  }

  download(organizationId: string, actorId: string, sourceId: string) {
    return this.unwrap(
      this.useCases.download(organizationId, actorId, sourceId),
    );
  }

  listSourcesForRelease(
    command: Parameters<SbomIntakeUseCases["listSourcesForRelease"]>[0],
  ) {
    return this.unwrap(this.useCases.listSourcesForRelease(command));
  }

  validationReport(
    command: Parameters<SbomIntakeUseCases["validationReport"]>[0],
  ) {
    return this.unwrap(this.useCases.validationReport(command));
  }

  listDocuments(
    command: Parameters<SbomNormalizationUseCases["listDocuments"]>[0],
  ) {
    return this.unwrap(this.normalization.listDocuments(command));
  }

  document(command: Parameters<SbomNormalizationUseCases["document"]>[0]) {
    return this.unwrap(this.normalization.document(command));
  }

  searchComponents(
    command: Parameters<SbomNormalizationUseCases["searchComponents"]>[0],
  ) {
    return this.unwrap(this.normalization.searchComponents(command));
  }

  dependencyTree(
    command: Parameters<SbomNormalizationUseCases["dependencyTree"]>[0],
  ) {
    return this.unwrap(this.normalization.dependencyTree(command));
  }

  qualityReport(command: Parameters<SbomQualityUseCases["report"]>[0]) {
    return this.unwrap(this.quality.report(command));
  }

  qualityFindings(command: Parameters<SbomQualityUseCases["findings"]>[0]) {
    return this.unwrap(this.quality.findings(command));
  }

  qualitySettings(command: Parameters<SbomQualityUseCases["settings"]>[0]) {
    return this.unwrap(this.quality.settings(command));
  }

  updateQualitySettings(
    command: Parameters<SbomQualityUseCases["updateSettings"]>[0],
  ) {
    return this.unwrap(this.quality.updateSettings(command));
  }

  replay(command: Parameters<SbomIntakeUseCases["replay"]>[0]) {
    return this.unwrap(this.useCases.replay(command));
  }

  async createCredential(
    organizationId: string,
    input: Readonly<{ actorId: string; label: string; idempotencyKey: string }>,
  ) {
    const created = await this.credentials.create(organizationId, input);
    if (typeof created === "string") throw this.failure({ code: created });
    return created;
  }

  async listCredentials(organizationId: string) {
    try {
      return Object.freeze({
        credentials: await this.credentials.list(organizationId),
      });
    } catch {
      throw this.failure({ code: "unavailable" });
    }
  }

  async revokeCredential(
    organizationId: string,
    input: Readonly<{
      credentialId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ) {
    const revoked = await this.credentials.revoke(organizationId, input);
    if (typeof revoked === "string") throw this.failure({ code: revoked });
    return Object.freeze({ credential: revoked });
  }

  private async unwrap<T>(
    pending: Promise<Result<T, SbomIntakeError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.failure(result.error);
  }

  private failure(error: Pick<SbomIntakeError, "code">): Error {
    const message = "SBOM intake request could not be completed.";
    switch (error.code) {
      case "invalid_request":
        return new BadRequestException({ message, code: error.code });
      case "not_found":
        return new NotFoundException({ message, code: error.code });
      case "conflict":
      case "idempotency_mismatch":
      case "content_hash_mismatch":
      case "source_missing":
        return new ConflictException({ message, code: error.code });
      case "unavailable":
        return new ServiceUnavailableException({ message, code: error.code });
    }
  }
}
