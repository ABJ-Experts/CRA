import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx, TenantScope } from '../db';
import {
  recordAudit,
  recordAuditInTx,
  verifyAuditChain,
  type AuditEventInput,
  type AuditWriteResult,
  type ChainVerification,
} from './audit.service';
import { DomainEventBus } from './domain-event-bus';

// Thin injectable facade over the audit functions so domain services can depend
// on it via DI. Prefer recordInTx() from inside a domain transaction so the audit
// row commits/rolls back atomically with the change it records.
@Injectable()
export class AuditService {
  record(
    scope: TenantScope,
    input: AuditEventInput,
  ): Promise<AuditWriteResult> {
    return recordAudit(scope, input);
  }

  recordInTx(
    tx: Tx,
    organisationId: string,
    input: AuditEventInput,
  ): Promise<AuditWriteResult> {
    return recordAuditInTx(tx, organisationId, input);
  }

  verifyChain(organisationId: string): Promise<ChainVerification> {
    return verifyAuditChain(organisationId);
  }
}

@Global()
@Module({
  providers: [AuditService, DomainEventBus],
  exports: [AuditService, DomainEventBus],
})
export class AuditModule {}
