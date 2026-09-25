import { PATH_METADATA } from "@nestjs/common/constants";

import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type RequestUser,
} from "../../auth/auth.types";
import { BrandingController } from "./branding.controller";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const user: RequestUser = Object.freeze({
  id: actorId,
  authUserId: "00000000-0000-4000-8000-000000000003",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
  sessionId: "00000000-0000-4000-8000-000000000004",
});

function handler(name: keyof BrandingController) {
  const value = Object.getOwnPropertyDescriptor(
    BrandingController.prototype,
    name,
  )?.value as unknown;
  if (typeof value !== "function") throw new Error(`Missing handler ${name}`);
  return value;
}

describe("BrandingController", () => {
  it("uses the current organization branding route prefix", () => {
    expect(Reflect.getMetadata(PATH_METADATA, BrandingController)).toBe(
      "organizations/current/branding",
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler("renderLogo"))).toBe(
      "logo/preview",
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, handler("renderPublishedLogo")),
    ).toBe("logo");
  });

  it("gates reads with view permission and writes with owner plus edit permission", () => {
    for (const name of [
      "resolved",
      "preview",
      "renderLogo",
      "renderPublishedLogo",
    ] as const) {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler(name)),
      ).toEqual(["can_view_organization"]);
      expect(
        Reflect.getMetadata(REQUIRE_ROLE_KEY, handler(name)),
      ).toBeUndefined();
    }

    for (const name of [
      "uploadLogo",
      "saveDraft",
      "publish",
      "removeLogo",
    ] as const) {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler(name)),
      ).toEqual(["can_edit_organization"]);
      expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, handler(name))).toBe(
        "owner",
      );
    }
  });

  it("forwards only guard-owned tenant and actor identity", async () => {
    const service = {
      resolved: jest.fn().mockResolvedValue({ branding: {} }),
      preview: jest.fn().mockResolvedValue({ branding: {} }),
      uploadLogo: jest.fn().mockResolvedValue({ branding: {} }),
      renderLogo: jest.fn().mockResolvedValue({
        bytes: Buffer.from("webp"),
        mimeType: "image/webp",
        sha256: "a".repeat(64),
      }),
      renderPublishedLogo: jest.fn().mockResolvedValue({
        bytes: Buffer.from("published-webp"),
        mimeType: "image/webp",
        sha256: "b".repeat(64),
      }),
      saveDraft: jest.fn().mockResolvedValue({ branding: {} }),
      publish: jest.fn().mockResolvedValue({ branding: {} }),
      removeLogo: jest.fn().mockResolvedValue({ branding: {} }),
    };
    const controller = new BrandingController(service as never);

    await controller.resolved(user);
    await controller.preview(user);
    await controller.uploadLogo(
      {
        altText: "Logo",
      },
      {
        buffer: Buffer.from("logo"),
        mimetype: "image/png",
      } as Express.Multer.File,
      user,
    );
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    await controller.renderLogo(user, response as never);
    const publishedResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    await controller.renderPublishedLogo(user, publishedResponse as never);
    await controller.saveDraft(
      {
        expectedVersion: 1,
        displayName: "Acme",
        palette: { primary: "#000000", secondary: "#FFFFFF" },
        logoAssetId: null,
      },
      user,
    );
    await controller.publish(
      {
        expectedVersion: 2,
        idempotencyKey: "00000000-0000-4000-8000-000000000005",
      },
      user,
    );
    await controller.removeLogo(
      {
        expectedVersion: 3,
        idempotencyKey: "00000000-0000-4000-8000-000000000006",
      },
      user,
    );

    expect(service.resolved).toHaveBeenCalledWith({ organizationId, actorId });
    expect(service.preview).toHaveBeenCalledWith({ organizationId, actorId });
    expect(service.uploadLogo).toHaveBeenCalledWith({
      organizationId,
      actorId,
      altText: "Logo",
      declaredMimeType: "image/png",
      sourceBytes: Buffer.from("logo"),
    });
    expect(service.renderLogo).toHaveBeenCalledWith({
      organizationId,
      actorId,
    });
    expect(response.setHeader.mock.calls).toEqual([
      ["Content-Type", "image/webp"],
      ["Cache-Control", "private, no-store"],
      ["ETag", `"${"a".repeat(64)}"`],
    ]);
    expect(response.send).toHaveBeenCalledWith(Buffer.from("webp"));
    expect(service.renderPublishedLogo).toHaveBeenCalledWith({
      organizationId,
      actorId,
    });
    expect(publishedResponse.setHeader.mock.calls).toEqual([
      ["Content-Type", "image/webp"],
      ["Cache-Control", "private, no-store"],
      ["ETag", `"${"b".repeat(64)}"`],
    ]);
    expect(publishedResponse.send).toHaveBeenCalledWith(
      Buffer.from("published-webp"),
    );
    expect(service.saveDraft).toHaveBeenCalledWith({
      organizationId,
      actorId,
      input: {
        expectedVersion: 1,
        displayName: "Acme",
        palette: { primary: "#000000", secondary: "#FFFFFF" },
        logoAssetId: null,
      },
    });
    expect(service.publish).toHaveBeenCalledWith({
      organizationId,
      actorId,
      input: {
        expectedVersion: 2,
        idempotencyKey: "00000000-0000-4000-8000-000000000005",
      },
    });
    expect(service.removeLogo).toHaveBeenCalledWith({
      organizationId,
      actorId,
      input: {
        expectedVersion: 3,
        idempotencyKey: "00000000-0000-4000-8000-000000000006",
      },
    });
  });

  it("fails closed when the guard did not resolve an active organization", () => {
    const controller = new BrandingController({} as never);

    expect(() =>
      controller.resolved({ ...user, organizationId: null }),
    ).toThrow();
  });
});
