import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { BackupWriteAdmissionGuard } from "./infrastructure/backup-write-admission.guard";
import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { CustomerBackupsController } from "./customer-backups.controller";
import { BackupAssuranceUseCases } from "./application/backup-assurance.use-cases";
import { SupabaseBackupAssuranceAdapter } from "./infrastructure/supabase-backup-assurance.adapter";
@Module({
  imports: [SupabaseModule, ConfigModule],
  controllers: [CustomerBackupsController],
  providers: [
    { provide: APP_GUARD, useClass: BackupWriteAdmissionGuard },
    SupabaseBackupAssuranceAdapter,
    {
      provide: BackupAssuranceUseCases,
      inject: [SupabaseBackupAssuranceAdapter],
      useFactory: (repository: SupabaseBackupAssuranceAdapter) =>
        new BackupAssuranceUseCases(repository),
    },
  ],
  exports: [BackupAssuranceUseCases],
})
export class BackupsModule {}
