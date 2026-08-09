import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from "@nestjs/common/constants";

import { AuditModule } from "../audit/audit.module";
import { UsersModule } from "./users.module";
import { UsersService } from "./users.service";

describe("UsersModule", () => {
  it("is explicit, imports auditing, and exports only its compatibility facade", () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, UsersModule)).not.toBe(
      true,
    );
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, UsersModule)).toContain(
      AuditModule,
    );
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, UsersModule)).toEqual([
      UsersService,
    ]);
  });
});
