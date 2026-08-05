// Public interface (Facade) for the audit module.
export { AuditModule, AuditService } from './audit.module';
export { DomainEventBus } from './domain-event-bus';
export type { DomainEvent, DomainEventHandler } from './domain-event-bus';
export {
  recordAudit,
  recordAuditInTx,
  verifyAuditChain,
  type AuditActorType,
  type AuditEventInput,
  type AuditWriteResult,
  type ChainVerification,
} from './audit.service';
