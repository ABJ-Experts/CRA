import { Module } from "@nestjs/common";
import { LicensingRuntimeModule } from "./licensing-runtime.module";
import { LicensingUploadsModule } from "./uploads/licensing-uploads.module";
import { LicensingController } from "./licensing.controller";
import { LicensingUsageController } from "./licensing-usage.controller";
@Module({
  imports: [LicensingRuntimeModule, LicensingUploadsModule],
  controllers: [LicensingController, LicensingUsageController],
  exports: [LicensingRuntimeModule],
})
export class LicensingModule {}
