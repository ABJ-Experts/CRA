// Advisory feed ingestion (FR-VULN-001/002). Internal to the vuln module — the
// rest of the app reaches this through ../index.ts.
export {
  EMPTY_BATCH,
  type AdvisoryEnrichment,
  type AffectedRange,
  type CpeRange,
  type FeedBatch,
  type FeedHttp,
  type FeedKey,
  type FeedSource,
  type FeedSyncContext,
  type KnownPackage,
  type RawAdvisory,
} from './feed-source';
export {
  kevCatalogueVersion,
  normaliseEpss,
  normaliseGhsa,
  normaliseKev,
  normaliseNvd,
  normaliseOsv,
  osvEcosystem,
  parseGhsaRange,
} from './normalise';
export {
  FetchFeedHttp,
  FEED_ENDPOINTS,
  EpssFeedSource,
  GhsaFeedSource,
  KevFeedSource,
  NvdFeedSource,
  OsvFeedSource,
  defaultFeedSources,
} from './sources';
export {
  feedHealth,
  knownPackagesForOrganisation,
  persistBatch,
  syncFeed,
  type FeedHealth,
  type FeedSyncResult,
} from './feed-sync.service';
