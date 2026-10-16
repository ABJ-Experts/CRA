import type {
  VulnerabilityCsafReconciliationDetail,
  VulnerabilityOfflineBundleImport,
} from "@repo/contracts/vulnerabilities";

import type {
  OfflineBundlePreparedImport,
  VulnerabilityOfflineBundleRepository,
} from "./offline-bundle-import.port";

export class OfflineBundleImportUnavailableError extends Error {
  constructor() {
    super("offline bundle import unavailable");
    this.name = "OfflineBundleImportUnavailableError";
  }
}

/**
 * Application boundary for durable mirror state. Multipart parsing, temporary
 * storage, and cryptographic verification live at the filesystem adapter
 * boundary; this class owns only inward repository interactions.
 */
export class OfflineBundleImportUseCases {
  constructor(
    private readonly repository: VulnerabilityOfflineBundleRepository,
  ) {}

  async preflight(
    input: Parameters<VulnerabilityOfflineBundleRepository["preflight"]>[0],
  ): Promise<OfflineBundlePreparedImport> {
    return this.call(() => this.repository.preflight(input));
  }

  async confirm(
    input: Parameters<VulnerabilityOfflineBundleRepository["confirm"]>[0],
  ): Promise<VulnerabilityOfflineBundleImport> {
    return this.call(() => this.repository.confirm(input));
  }

  async get(importId: string): Promise<VulnerabilityOfflineBundleImport> {
    return this.call(() => this.repository.get(importId));
  }

  async csafReconciliation(
    canonicalId: string,
  ): Promise<VulnerabilityCsafReconciliationDetail | null> {
    return this.call(() => this.repository.csafReconciliation(canonicalId));
  }

  async stage(
    input: Parameters<VulnerabilityOfflineBundleRepository["stage"]>[0],
  ): Promise<void> {
    return this.call(() => this.repository.stage(input));
  }

  async completeStaging(
    input: Parameters<
      VulnerabilityOfflineBundleRepository["completeStaging"]
    >[0],
  ): Promise<void> {
    return this.call(() => this.repository.completeStaging(input));
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new OfflineBundleImportUnavailableError();
    }
  }
}
