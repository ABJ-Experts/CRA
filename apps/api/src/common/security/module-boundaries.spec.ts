import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from "@nestjs/common/constants";
import { APP_GUARD } from "@nestjs/core";

import { AppModule } from "../../app.module";
import { AuditModule } from "../../audit/audit.module";
import { AuthModule } from "../../auth/auth.module";
import { InvitationsModule } from "../../invitations/invitations.module";
import { MailModule } from "../../mail/mail.module";
import { PermissionsModule } from "../../permissions/permissions.module";
import { SupabaseModule } from "../../supabase/supabase.module";
import { UsersModule } from "../../users/users.module";
import { SecurityModule } from "./security.module";

const importsOf = (module: object): readonly unknown[] =>
  (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as
    readonly unknown[] | undefined) ?? [];

const providersOf = (module: object): readonly unknown[] =>
  (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) as
    readonly unknown[] | undefined) ?? [];

describe("explicit module boundaries", () => {
  it.each([SupabaseModule, MailModule, PermissionsModule])(
    "%p is not global",
    (module) => {
      expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, module)).not.toBe(
        true,
      );
    },
  );

  it.each([
    [AuditModule, [SupabaseModule]],
    [AuthModule, [AuditModule, SupabaseModule, MailModule]],
    [InvitationsModule, [AuditModule, SupabaseModule, MailModule]],
    [PermissionsModule, [AuditModule, SupabaseModule]],
    [UsersModule, [AuditModule, SupabaseModule]],
  ] as const)(
    "%p imports its provider dependencies",
    (module, dependencies) => {
      expect(importsOf(module)).toEqual(expect.arrayContaining(dependencies));
    },
  );

  it("registers global guards only in SecurityModule", () => {
    for (const module of [AuthModule, PermissionsModule]) {
      expect(providersOf(module)).not.toContainEqual(
        expect.objectContaining({ provide: APP_GUARD }),
      );
    }
    expect(importsOf(AppModule)).toContain(SecurityModule);
  });
});
