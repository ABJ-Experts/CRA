import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { SupabaseModule } from "../supabase/supabase.module";
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from "./application/member-repository.port";
import { MemberUseCases } from "./application/member-use-cases";
import { SupabaseMemberRepository } from "./infrastructure/supabase-member.repository";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuditModule, SupabaseModule],
  controllers: [UsersController],
  providers: [
    SupabaseMemberRepository,
    {
      provide: MEMBER_REPOSITORY,
      useExisting: SupabaseMemberRepository,
    },
    {
      provide: MemberUseCases,
      useFactory: (repository: MemberRepository, audit: AuditService) =>
        new MemberUseCases(repository, audit),
      inject: [MEMBER_REPOSITORY, AuditService],
    },
    UsersService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
