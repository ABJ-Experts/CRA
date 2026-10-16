import { PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import {
  FindingPropagationSourcesController,
  ProductFindingImpactSummaryController,
} from "./findings.controller";

const ids = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  actor: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  release: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  key: "66666666-6666-4666-8666-666666666666",
  correlation: "77777777-7777-4777-8777-777777777777",
});
const at = "2026-08-14T11:00:00.000Z";
const user = Object.freeze({
  id: ids.actor,
  organizationId: ids.organization,
  role: "admin",
} as RequestUser);

describe("finding propagation controllers", () => {
  it("keeps source registration behind the findings write permission", () => {
    const handler = Object.getOwnPropertyDescriptor(
      FindingPropagationSourcesController.prototype,
      "register",
    )?.value as object;
    expect(
      Reflect.getMetadata(PATH_METADATA, FindingPropagationSourcesController),
    ).toBe("findings/propagation-sources");
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
      "can_edit_findings",
    ]);
  });

  it("forwards a parsed opaque source command with verified organization identity", async () => {
    const findings = { registerSource: jest.fn().mockResolvedValue({}) };
    const controller = new FindingPropagationSourcesController(
      findings as never,
    );
    const input = {
      sourceSystem: "sbom-correlation",
      sourceFindingKey: "opaque-finding-42",
      sourceProductId: ids.product,
      sourceReleaseId: ids.release,
      ruleVersion: "m2-v1",
      source: "SBOM correlation service",
      provenance: "Signed ingest batch 2026-08-14",
      idempotencyKey: ids.key,
      correlationId: ids.correlation,
    };

    await controller.register(input, user);

    expect(findings.registerSource).toHaveBeenCalledWith({
      organizationId: ids.organization,
      actorId: ids.actor,
      input,
    });
  });

  it("keeps source re-scoping/version changes behind findings edit permission", async () => {
    const findings = { updateSource: jest.fn().mockResolvedValue({}) };
    const controller = new FindingPropagationSourcesController(
      findings as never,
    );
    const handler = Object.getOwnPropertyDescriptor(
      FindingPropagationSourcesController.prototype,
      "update",
    )?.value as object;
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
      "can_edit_findings",
    ]);
    const input = {
      sourceProductId: ids.product,
      sourceReleaseId: ids.release,
      ruleVersion: "m2-v2",
      status: "active",
      reason: "The release mapping was corrected after a signed SBOM review.",
      source: "SBOM correlation service",
      provenance: "Signed ingest batch 2026-08-14",
      expectedVersion: 2,
      idempotencyKey: ids.key,
      correlationId: ids.correlation,
    } as const;

    await controller.update({ sourceId: ids.source }, input, user);

    expect(findings.updateSource).toHaveBeenCalledWith({
      organizationId: ids.organization,
      actorId: ids.actor,
      sourceId: ids.source,
      input,
    });
  });

  it("uses product read permission for aggregate-only impact summary", async () => {
    const findings = {
      getProductImpactSummary: jest.fn().mockResolvedValue({}),
    };
    const controller = new ProductFindingImpactSummaryController(
      findings as never,
    );
    const handler = Object.getOwnPropertyDescriptor(
      ProductFindingImpactSummaryController.prototype,
      "getSummary",
    )?.value as object;
    expect(
      Reflect.getMetadata(PATH_METADATA, ProductFindingImpactSummaryController),
    ).toBe("products");
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
      "can_view_products",
    ]);

    await controller.getSummary(
      { productId: ids.product },
      { releaseId: ids.release },
      user,
    );

    expect(findings.getProductImpactSummary).toHaveBeenCalledWith({
      organizationId: ids.organization,
      actorId: ids.actor,
      productId: ids.product,
      query: { releaseId: ids.release },
    });
  });

  it("requires findings edit permission for a product-specific override", async () => {
    const findings = {
      createProductImpactOverride: jest.fn().mockResolvedValue({}),
    };
    const controller = new ProductFindingImpactSummaryController(
      findings as never,
    );
    const handler = Object.getOwnPropertyDescriptor(
      ProductFindingImpactSummaryController.prototype,
      "createOverride",
    )?.value as object;
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
      "can_edit_findings",
    ]);

    const input = {
      affectedReleaseId: ids.release,
      overrideState: "not_applicable",
      reason: "This build omits the vulnerable optional component.",
      source: "Product configuration review",
      provenance: "Approved configuration record CFG-42",
      effectiveStartsAt: at,
      idempotencyKey: ids.key,
      correlationId: ids.correlation,
    } as const;
    await controller.createOverride(
      { productId: ids.product, sourceId: ids.source },
      input,
      user,
    );

    expect(findings.createProductImpactOverride).toHaveBeenCalledWith({
      organizationId: ids.organization,
      actorId: ids.actor,
      productId: ids.product,
      sourceId: ids.source,
      input,
    });
  });

  it("ends an override with the same findings permission and optimistic command", async () => {
    const findings = {
      endProductImpactOverride: jest.fn().mockResolvedValue({}),
    };
    const controller = new ProductFindingImpactSummaryController(
      findings as never,
    );
    const handler = Object.getOwnPropertyDescriptor(
      ProductFindingImpactSummaryController.prototype,
      "endOverride",
    )?.value as object;
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
      "can_edit_findings",
    ]);

    const input = {
      expectedVersion: 2,
      reason: "The optional component is enabled in the replacement build.",
      idempotencyKey: ids.key,
      correlationId: ids.correlation,
    } as const;
    await controller.endOverride(
      { productId: ids.product, sourceId: ids.source, overrideId: ids.key },
      input,
      user,
    );

    expect(findings.endProductImpactOverride).toHaveBeenCalledWith({
      organizationId: ids.organization,
      actorId: ids.actor,
      productId: ids.product,
      sourceId: ids.source,
      overrideId: ids.key,
      input,
    });
  });
});
