import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OfflineBundleImportUseCases } from "./application/offline-bundle-import-use-cases";
import { OfflineBundlePreflightService } from "./application/offline-bundle-preflight.service";
import { OfflineBundleImportsController } from "./offline-bundle-imports.controller";
import type { RequestUser } from "../auth/auth.types";

const user: RequestUser = {
  id: "c0a80168-0000-4000-8000-000000000001",
  authUserId: "auth-user",
  email: "owner@cra.test",
  isActive: true,
  organizationId: null,
  role: "owner",
  accessToken: "test-token",
  aal: "aal2",
};

describe("OfflineBundleImportsController", () => {
  it("removes temporary multipart files when a required payload part is missing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "cra-vulnerability-bundle-"),
    );
    const files = {
      manifest: [await multipartFile(directory, "manifest")],
      signature: [await multipartFile(directory, "signature")],
      payloads: [],
    };
    const invokePreflight = jest.fn();
    const preflight = {
      preflight: invokePreflight,
    } as unknown as OfflineBundlePreflightService;
    const controller = new OfflineBundleImportsController(
      preflight,
      {} as OfflineBundleImportUseCases,
    );

    await expect(
      controller.preflightBundle(
        { idempotencyKey: "c0a80168-0000-4000-8000-000000000002" },
        files as never,
        user,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(invokePreflight).not.toHaveBeenCalled();
  });
});

async function multipartFile(directory: string, name: string) {
  const path = join(directory, name.replace("/", "-"));
  await writeFile(path, "x");
  return {
    path,
    originalname: name,
    size: 1,
  } as Express.Multer.File;
}
