import { Injectable } from '@nestjs/common';

export interface DomainEvent<T = unknown> {
  type: string; // e.g. 'finding.state_changed'
  organisationId: string;
  actorId?: string | null;
  correlationId?: string | null;
  payload: T;
}

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * Observer: a domain state change fans out to registered sinks (notifications,
 * projections, …) without the emitter knowing its consumers. The audit ledger is
 * written in-transaction by the domain service directly (atomic with the change,
 * ADR-012); this bus carries after-commit side effects such as email (FR-WF-005).
 */
@Injectable()
export class DomainEventBus {
  private readonly handlers = new Set<DomainEventHandler>();

  subscribe(handler: DomainEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async emit(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }
}
