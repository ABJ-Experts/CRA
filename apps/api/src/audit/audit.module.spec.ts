import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from "@nestjs/common/constants";

import { AuditModule } from "./audit.module";
import { AuditExplorerController } from "./audit-explorer.controller";
import { AuditExplorerDeniedFilter } from "./audit-explorer-denied.filter";
import { AUDIT_EXPLORER_REPOSITORY } from "./application/audit-explorer.port";
import { AuditExplorerTokenService } from "./audit-explorer-token.service";
import { AuditExplorerUseCases } from "./application/audit-explorer.use-cases";
import { AuditService } from "./audit.service";
import { SupabaseAuditExplorerRepository } from "./supabase-audit-explorer.repository";
import { SupabaseAuditExportStorageAdapter } from "./infrastructure/audit-export-storage.adapter";
import { AuditRangeController } from "./range/audit-range.controller";
import { AuditRangeDeniedFilter } from "./range/audit-range-denied.filter";
import { AUDIT_RANGE_REPOSITORY } from "./range/application/audit-range.port";
import { AuditRangeUseCases } from "./range/application/audit-range.use-cases";
import { SupabaseAuditRangeRepository } from "./range/infrastructure/supabase-audit-range.repository";

describe("AuditModule", () => {
  it("exports auditing without recreating hidden global coupling", () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, AuditModule)).not.toBe(
      true,
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuditModule),
    ).toEqual([AuditExplorerController, AuditRangeController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuditModule)).toEqual(
      [
        AuditService,
        SupabaseAuditRangeRepository,
        AuditRangeDeniedFilter,
        {
          provide: AUDIT_RANGE_REPOSITORY,
          useExisting: SupabaseAuditRangeRepository,
        },
        {
          provide: AuditRangeUseCases,
          useFactory: expect.any(Function) as () => AuditRangeUseCases,
          inject: [
            SupabaseAuditRangeRepository,
            SupabaseAuditExplorerRepository,
          ],
        },
        {
          provide: AuditExplorerUseCases,
          useFactory: expect.any(Function) as () => AuditExplorerUseCases,
          inject: [SupabaseAuditExplorerRepository, AuditExplorerTokenService],
        },
        AuditExplorerTokenService,
        AuditExplorerDeniedFilter,
        SupabaseAuditExportStorageAdapter,
        SupabaseAuditExplorerRepository,
        {
          provide: AUDIT_EXPLORER_REPOSITORY,
          useExisting: SupabaseAuditExplorerRepository,
        },
      ],
    );
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuditModule)).toEqual([
      AuditService,
    ]);
  });
});
