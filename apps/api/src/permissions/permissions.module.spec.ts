import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from "@nestjs/common/constants";

import { AuditModule } from "../audit/audit.module";
import { ROLE_REPOSITORY } from "./application/role-repository.port";
import { RoleUseCases } from "./application/role-use-cases";
import { SupabaseRoleRepository } from "./infrastructure/supabase-role.repository";
import { PermissionsModule } from "./permissions.module";

describe("PermissionsModule role composition", () => {
  it("keeps permission visibility while wiring role ports explicitly", () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, PermissionsModule)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, PermissionsModule),
    ).toContain(AuditModule);

    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PermissionsModule,
    ) as unknown[];
    expect(providers).toContain(SupabaseRoleRepository);
    expect(providers).toContainEqual({
      provide: ROLE_REPOSITORY,
      useExisting: SupabaseRoleRepository,
    });
    expect(providers).toContainEqual(
      expect.objectContaining({
        provide: RoleUseCases,
        inject: [ROLE_REPOSITORY, expect.any(Function)],
      }),
    );
  });
});
