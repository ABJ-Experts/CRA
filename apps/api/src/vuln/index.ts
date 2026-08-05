// Public interface (Facade) for the vuln module.
export { matchRelease, type MatchReleaseResult } from './matching.service';
export {
  reevaluateForAdvisories,
  type ReevaluationResult,
} from './reevaluate.service';
export {
  FetchFeedHttp,
  defaultFeedSources,
  feedHealth,
  knownPackagesForOrganisation,
  persistBatch,
  syncFeed,
  type FeedHealth,
  type FeedKey,
  type FeedSource,
  type FeedSyncContext,
  type FeedSyncResult,
} from './feeds';
export { VulnModule } from './vuln.module';
