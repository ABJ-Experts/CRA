import { Global, Module } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Global()
@Module({
  controllers: [UsersController],
  providers: [UsersService, AuditService],
  exports: [UsersService, AuditService],
})
export class UsersModule {}
