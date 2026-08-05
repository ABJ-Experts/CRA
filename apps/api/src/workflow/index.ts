// Public interface (Facade) for the workflow module.
export {
  openObligation,
  openObligationFromFinding,
  recordAnchor,
  listObligations,
  listStages,
  tickObligations,
  type ObligationType,
  type AnchorEvent,
  type OpenObligationInput,
  type ObligationView,
  type StageView,
  type ObligationNotification,
  type TickResult,
} from './obligation.service';
export {
  computeDueAt,
  addCalendarMonths,
  parseIsoDuration,
} from './obligation-clock';
export { evaluateStage, ESCALATION_THRESHOLDS } from './obligation-tick';
export { WorkflowService } from './workflow.service';
export {
  NOTIFICATION_SENDER,
  orgRecipients,
  type NotificationSender,
  type NotificationMessage,
} from './notification-sender';
export { WorkflowModule } from './workflow.module';
