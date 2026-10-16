import { Module } from "@nestjs/common";
import { AesGcmConnectorVault } from "../connectors/infrastructure/connector-vault";
import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseService } from "../supabase/supabase.service";
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from "./application/notification.port";
import { NotificationsUseCases } from "./application/notifications-use-cases";
import { SupabaseChatNotificationRepository } from "./infrastructure/supabase-chat-notification.repository";
import { SupabaseNotificationRepository } from "./infrastructure/supabase-notification.repository";
import { NotificationsController } from "./notifications.controller";
import { ChatProviderDeliveryAdapter } from "./worker/chat-provider-delivery.adapter";

@Module({
  imports: [SupabaseModule],
  controllers: [NotificationsController],
  providers: [
    SupabaseNotificationRepository,
    ChatProviderDeliveryAdapter,
    {
      provide: AesGcmConnectorVault,
      useFactory: () =>
        new AesGcmConnectorVault(process.env.CONNECTOR_VAULT_KEYRING),
    },
    {
      provide: SupabaseChatNotificationRepository,
      inject: [
        SupabaseService,
        AesGcmConnectorVault,
        ChatProviderDeliveryAdapter,
      ],
      useFactory: (
        supabase: SupabaseService,
        vault: AesGcmConnectorVault,
        delivery: ChatProviderDeliveryAdapter,
      ) => new SupabaseChatNotificationRepository(supabase, vault, delivery),
    },
    {
      provide: NOTIFICATION_REPOSITORY,
      useExisting: SupabaseNotificationRepository,
    },
    {
      provide: NotificationsUseCases,
      inject: [NOTIFICATION_REPOSITORY, SupabaseChatNotificationRepository],
      useFactory: (
        repository: NotificationRepository,
        chatRepository: SupabaseChatNotificationRepository,
      ) => new NotificationsUseCases(repository, chatRepository),
    },
  ],
  exports: [
    NOTIFICATION_REPOSITORY,
    SupabaseNotificationRepository,
    SupabaseChatNotificationRepository,
    NotificationsUseCases,
  ],
})
export class NotificationsModule {}
