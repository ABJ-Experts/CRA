// Public interface (Facade) for the triage module.
export {
  listFindings,
  getFinding,
  transitionFindingState,
  recordVexAssessment,
  canTransitionFinding,
  confidenceThreshold,
  markFalsePositive,
  falsePositiveRates,
  FALSE_POSITIVE_REASONS,
  VEX_JUSTIFICATIONS,
  type FalsePositiveReason,
  type FalsePositiveRate,
  type FindingState,
  type FindingView,
  type FindingPage,
  type FindingFilter,
  type VexStatus,
  type VexJustification,
  type TransitionOptions,
  type VexInput,
} from './triage.service';
export { TriageModule } from './triage.module';
