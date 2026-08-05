import type { Ecosystem } from '@repo/sbom-core';

/**
 * FR-VULN-001/002 — the advisory feed port.
 *
 * Two kinds of feed exist and both go through one interface, because the sync
 * orchestrator, the checkpointing and the staleness reporting are identical:
 *
 *  - `advisories`: OSV, NVD, GHSA. These CREATE advisory rows and the affected
 *    version ranges the matcher keys on.
 *  - `enrichment`: KEV, EPSS. These never create an advisory from nothing; they
 *    PATCH existing rows by public identifier (a CVE id). An EPSS score for a CVE
 *    nobody ships is noise, and inventing a bare advisory row for it would make
 *    the mirror's row count meaningless.
 */
export type FeedKey = 'osv' | 'nvd' | 'ghsa' | 'kev' | 'epss';

export type AdvisorySource = 'osv' | 'nvd' | 'ghsa' | 'vendor';

export interface AffectedRange {
  ecosystem: Ecosystem;
  packageName: string;
  namespace: string | null;
  introduced: string | null;
  fixed: string | null;
  lastAffected: string | null;
}

export interface CpeRange {
  cpe: string;
  versionStartIncluding: string | null;
  versionEndExcluding: string | null;
  versionSpecific: boolean;
}

/** A full advisory record, normalised onto our columns. */
export interface RawAdvisory {
  source: AdvisorySource;
  advisoryId: string;
  summary: string | null;
  cvssBase: number | null;
  cvssVector: string | null;
  cweIds: string[];
  publishedAt: Date | null;
  modifiedAt: Date | null;
  affected: AffectedRange[];
  cpes: CpeRange[];
}

/** A patch applied to whatever advisory already carries this public identifier. */
export interface AdvisoryEnrichment {
  advisoryId: string;
  kevListed?: boolean;
  kevAddedAt?: Date | null;
  epssScore?: number | null;
}

export interface FeedBatch {
  advisories: RawAdvisory[];
  enrichments: AdvisoryEnrichment[];
  /**
   * Opaque resume token persisted to advisory_feed_sync_state.checkpoint. A
   * modified-since timestamp for NVD, a catalogue version for KEV, a score date
   * for EPSS. Null means "this feed has no incremental mode; it was read whole".
   */
  checkpoint: string | null;
  /** True when more remains and the job should run again immediately. */
  hasMore: boolean;
}

export const EMPTY_BATCH: FeedBatch = {
  advisories: [],
  enrichments: [],
  checkpoint: null,
  hasMore: false,
};

/**
 * The IO seam. Every network call in the feed subsystem goes through this, so the
 * normalisation tests run against committed fixtures with no egress — which is
 * also what makes FR-DEP-008 (no component requires outbound internet) checkable
 * rather than aspirational.
 */
export interface FeedHttp {
  getJson(url: string, headers?: Record<string, string>): Promise<unknown>;
  postJson(url: string, body: unknown): Promise<unknown>;
  /** Returns decompressed text; the caller does not care whether it was gzipped. */
  getText(url: string, headers?: Record<string, string>): Promise<string>;
}

/**
 * A package this deployment actually ships. The PURL type is carried alongside
 * the comparator ecosystem because they answer different questions: `semver` is
 * how we order versions, `npm` vs `crates.io` is who to ask about them.
 */
export interface KnownPackage {
  purlType: string;
  namespace: string | null;
  name: string;
  ecosystem: Ecosystem;
}

export interface FeedSyncContext {
  http: FeedHttp;
  /**
   * The packages present in the SBOMs this sync is scoped to. OSV is mirrored on
   * demand against this set — see OsvFeedSource for why. Global feeds ignore it.
   */
  knownPackages: () => Promise<KnownPackage[]>;
}

export interface FeedSource {
  readonly key: FeedKey;
  fetch(checkpoint: string | null, ctx: FeedSyncContext): Promise<FeedBatch>;
}
