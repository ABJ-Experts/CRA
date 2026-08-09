import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from "@nestjs/common/constants";

import { AuditModule } from "./audit.module";
import { AuditService } from "./audit.service";

describe("AuditModule", () => {
  it("exports auditing without recreating hidden global coupling", () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, AuditModule)).not.toBe(
      true,
    );
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuditModule)).toEqual(
      [AuditService],
    );
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuditModule)).toEqual([
      AuditService,
    ]);
  });
});
