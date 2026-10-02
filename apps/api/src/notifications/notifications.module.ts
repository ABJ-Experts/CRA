import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from "./application/notification.port";
import { NotificationsUseCases } from "./application/notifications-use-cases";
import { SupabaseNotificationRepository } from "./infrastructure/supabase-notification.repository";
import { NotificationsController } from "./notifications.controller";

@Module({
  imports: [SupabaseModule],
  controllers: [NotificationsController],
  providers: [
    SupabaseNotificationRepository,
    {
      provide: NOTIFICATION_REPOSITORY,
      useExisting: SupabaseNotificationRepository,
    },
    {
      provide: NotificationsUseCases,
      inject: [NOTIFICATION_REPOSITORY],
      useFactory: (repository: NotificationRepository) =>
        new NotificationsUseCases(repository),
    },
  ],
  exports: [
    NOTIFICATION_REPOSITORY,
    SupabaseNotificationRepository,
    NotificationsUseCases,
  ],
})
export class NotificationsModule {}
