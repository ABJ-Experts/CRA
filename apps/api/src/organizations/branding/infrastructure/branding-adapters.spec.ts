import {
  ConfigBrandingScannerPolicyAdapter,
  NodeBrandingRequestIdentityAdapter,
  UnavailableBrandingScannerAdapter,
} from "./branding-adapters";

describe("branding infrastructure adapters", () => {
  it("reports scanner unavailable without deciding policy", async () => {
    await expect(
      new UnavailableBrandingScannerAdapter().scan(),
    ).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("reads a boot-validated scanner policy without coercion", () => {
    const nonStrict = new ConfigBrandingScannerPolicyAdapter({
      getOrThrow: jest.fn().mockReturnValue(false),
    } as never);
    const strict = new ConfigBrandingScannerPolicyAdapter({
      getOrThrow: jest.fn().mockReturnValue(true),
    } as never);

    expect(nonStrict.isStrict()).toBe(false);
    expect(strict.isStrict()).toBe(true);
  });

  it("binds branding request digests to operation, tenant, actor, and key", () => {
    const adapter = new NodeBrandingRequestIdentityAdapter();

    expect(
      adapter.create({
        organizationId: "org",
        actorId: "actor",
        idempotencyKey: "key",
        operation: "publish_branding",
      }).requestDigest,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      adapter.create({
        organizationId: "org",
        actorId: "actor",
        idempotencyKey: "key",
        operation: "publish_branding",
      }),
    ).toEqual(
      adapter.create({
        organizationId: "org",
        actorId: "actor",
        idempotencyKey: "key",
        operation: "publish_branding",
      }),
    );
    expect(
      adapter.create({
        organizationId: "org",
        actorId: "actor",
        idempotencyKey: "key",
        operation: "publish_branding",
      }),
    ).not.toEqual(
      adapter.create({
        organizationId: "org",
        actorId: "actor",
        idempotencyKey: "key",
        operation: "remove_branding_logo",
      }),
    );
  });
});
