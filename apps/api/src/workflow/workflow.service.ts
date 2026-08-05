import { Inject, Injectable } from '@nestjs/common';
import { DomainEventBus } from '../audit';
import { tickObligations, type TickResult } from './obligation.service';

@Injectable()
export class WorkflowService {
  // @Inject keeps DomainEventBus a runtime value under esbuild/tsx (it is
  // otherwise elided as a type-only import → undefined dependency).
  constructor(@Inject(DomainEventBus) private readonly bus: DomainEventBus) {}

  /**
   * FR-SLA-005: reconcile one org's obligations against the clock, then fan each
   * escalation out on the Observer bus. The NotificationSubscriber turns those
   * into email (FR-WF-005) — this service never references the transport.
   */
  async tick(organisationId: string, now: Date): Promise<TickResult> {
    const result = await tickObligations(organisationId, now);
    for (const notification of result.notifications) {
      await this.bus.emit({
        type: 'obligation.escalation',
        organisationId,
        payload: notification,
      });
    }
    return result;
  }
}
