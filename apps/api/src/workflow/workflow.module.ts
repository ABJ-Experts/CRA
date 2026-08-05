import { Module } from '@nestjs/common';
import { ObligationController } from './obligation.controller';
import { WorkflowService } from './workflow.service';
import { NotificationSubscriber } from './notification.subscriber';
import {
  NOTIFICATION_SENDER,
  LoggingNotificationSender,
} from './notification-sender';

@Module({
  controllers: [ObligationController],
  providers: [
    WorkflowService,
    // Observer sink: instantiated at boot so it subscribes to the DomainEventBus.
    NotificationSubscriber,
    // Adapter: swap for an SMTP sender in V1 without touching the domain.
    { provide: NOTIFICATION_SENDER, useClass: LoggingNotificationSender },
  ],
  exports: [WorkflowService, NOTIFICATION_SENDER],
})
export class WorkflowModule {}
