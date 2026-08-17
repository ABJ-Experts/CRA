import { PATH_METADATA } from "@nestjs/common/constants";

import {
  REQUIRE_PERMISSIONS_KEY,
  type RequestUser,
} from "../../auth/auth.types";
import { ProductImportsController } from "./product-imports.controller";

describe("ProductImportsController", () => {
  it("uses the static products/imports prefix and server-enforced permissions", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProductImportsController)).toBe(
      "products/imports",
    );
    const expected: Readonly<Record<string, readonly string[]>> = {
      template: ["can_view_products"],
      list: ["can_view_products"],
      dryRun: ["can_create_products", "can_edit_products"],
      get: ["can_view_products"],
      rows: ["can_view_products"],
      commit: ["can_create_products", "can_edit_products"],
      cancel: ["can_create_products", "can_edit_products"],
      report: ["can_export_products"],
    };
    for (const [name, permissions] of Object.entries(expected)) {
      const handler = Object.getOwnPropertyDescriptor(
        ProductImportsController.prototype,
        name,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual(
        permissions,
      );
    }
  });

  it("passes only verified organization identity and bounded file bytes", async () => {
    const imports = { dryRun: jest.fn().mockResolvedValue({ import: {} }) };
    const controller = new ProductImportsController(imports as never);
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "admin",
    } as RequestUser;
    const bytes = Buffer.from("format_version\n");

    await controller.dryRun(
      { idempotencyKey: "00000000-0000-4000-8000-000000000003" },
      {
        originalname: "input.csv",
        mimetype: "text/csv",
        buffer: bytes,
      } as Express.Multer.File,
      user,
    );

    expect(imports.dryRun).toHaveBeenCalledWith({
      organizationId: user.organizationId,
      actorId: user.id,
      fields: {
        idempotencyKey: "00000000-0000-4000-8000-000000000003",
      },
      originalFilename: "input.csv",
      bytes,
    });
  });
});
