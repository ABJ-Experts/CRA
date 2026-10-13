import { MODULE_METADATA } from "@nestjs/common/constants";
import { LicensingModule } from "./licensing.module";
import { LicensingRuntimeModule } from "./licensing-runtime.module";
import { LicensingUploadsModule } from "./uploads/licensing-uploads.module";
import { LicensingController } from "./licensing.controller";
import { LicensingUsageController } from "./licensing-usage.controller";

describe("licensing API composition", () => {
  it("exposes the management controller through the shared runtime and bounded transport", () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, LicensingModule),
    ).toEqual([LicensingRuntimeModule, LicensingUploadsModule]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, LicensingModule),
    ).toEqual([LicensingController, LicensingUsageController]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, LicensingModule),
    ).toEqual([LicensingRuntimeModule]);
  });
});
