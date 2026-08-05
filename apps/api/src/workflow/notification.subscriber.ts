import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainEventBus, type DomainEvent } from '../audit';
import {
  NOTIFICATION_SENDER,
  orgRecipients,
  type NotificationSender,
} from './notification-sender';
import type { ObligationNotification } from './obligation.service';

/**
 * Observer sink: subscribes once at boot and turns obligation-escalation domain
 * events into email via the NotificationSender adapter (FR-WF-005). Decoupled from
 * the emitter — nothing in the domain knows email exists.
 */
@Injectable()
export class NotificationSubscriber implements OnModuleInit {
  constructor(
    @Inject(DomainEventBus) private readonly bus: DomainEventBus,
    @Inject(NOTIFICATION_SENDER) private readonly sender: NotificationSender,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe((event) => this.handle(event));
  }

  private async handle(event: DomainEvent): Promise<void> {
    if (event.type !== 'obligation.escalation') return;
    const n = event.payload as ObligationNotification;
    const recipients = await orgRecipients(event.organisationId);
    const overdue = n.kind === 'overdue';
    const pct = Math.round(n.threshold * 100);
    await this.sender.send({
      organisationId: event.organisationId,
      category: 'obligation_deadline',
      subject: overdue
        ? `OVERDUE: ${n.stage} reporting deadline has passed`
        : `Reporting deadline ${pct}% elapsed — ${n.stage}`,
      body:
        `The ${n.stage} stage of a reporting obligation is ` +
        (overdue ? 'now OVERDUE' : `${pct}% toward its deadline`) +
        ` (due ${n.dueAt.toISOString()} UTC).`,
      recipients,
    });
  }
}
