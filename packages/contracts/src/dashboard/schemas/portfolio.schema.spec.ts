import { describe, expect, it } from "vitest";
import {
  portfolioProductsQuerySchema,
  portfolioConcentrationQuerySchema,
  portfolioDetailQuerySchema,
  portfolioCoverageSchema,
  portfolioMatchingCoverageSchema,
  portfolioConcentrationRowSchema,
  portfolioComponentSchema,
  portfolioProductsResponseSchema,
  portfolioConcentrationResponseSchema,
  portfolioDetailResponseSchema,
} from "./portfolio.schema.js";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-12T12:00:00Z";
const withheld = { state: "restricted", observedAt: null, updatedAt: null };
const base = {
  organizationId: id,
  serverNow: now,
  generatedAt: now,
  scope: { legalEntityId: null, productId: null, includeArchived: false },
  coverage: withheld,
  matchingCoverage: withheld,
  feedFreshness: withheld,
};
const coverage = {
  eligibleReleases: 2,
  coveredReleases: 1,
  missingReleases: 1,
  percent: 50,
  totalComponents: 5,
  rankableComponents: 1,
  excludedIdentity: {
    missingPurl: 1,
    missingVersion: 1,
    invalidPurl: 1,
    versionConflict: 1,
  },
};
const component = {
  packageIdentity: "pkg:npm/%40example/lib?arch=x64#src",
  version: "1.0.0",
  componentRef: "opaque",
  productCount: 2,
  releaseCount: 3,
  findings: withheld,
};
describe("portfolio contracts", () => {
  it("defaults and bounds strict filters without truthiness coercion", () => {
    for (const schema of [
      portfolioProductsQuerySchema,
      portfolioConcentrationQuerySchema,
    ]) {
      expect(schema.parse({})).toEqual({ includeArchived: false, limit: 20 });
      expect(
        schema.parse({
          includeArchived: "true",
          limit: "100",
          productId: id,
          legalEntityId: id,
        }),
      ).toMatchObject({ includeArchived: true, limit: 100 });
      expect(
        schema.parse({ includeArchived: "false", limit: 1 }).includeArchived,
      ).toBe(false);
      for (const input of [
        { limit: 101 },
        { limit: 0 },
        { limit: true },
        { limit: "1.2" },
        { includeArchived: "yes" },
        { organizationId: id },
        { productId: "foreign" },
        { legalEntityId: "foreign" },
        { cursor: "../secret" },
      ])
        expect(schema.safeParse(input).success).toBe(false);
    }
    expect(
      portfolioDetailQuerySchema.parse({ componentRef: "opaque" }),
    ).toMatchObject({ componentRef: "opaque", limit: 20 });
    expect(portfolioDetailQuerySchema.safeParse({}).success).toBe(false);
    expect(
      portfolioDetailQuerySchema.safeParse({ componentRef: "../secret" })
        .success,
    ).toBe(false);
  });
  it("reconciles release and identity coverage and absence", () => {
    expect(portfolioCoverageSchema.parse(coverage)).toEqual(coverage);
    expect(
      portfolioCoverageSchema.parse({
        ...coverage,
        eligibleReleases: 0,
        coveredReleases: 0,
        missingReleases: 0,
        percent: null,
      }),
    ).toBeDefined();
    for (const change of [
      { missingReleases: 0 },
      { percent: 0 },
      { percent: null },
      { rankableComponents: 2 },
      { totalComponents: 0 },
      { eligibleReleases: 0, percent: 100 },
    ])
      expect(
        portfolioCoverageSchema.safeParse({ ...coverage, ...change }).success,
      ).toBe(false);
  });
  it("keeps matching evidence independently gated and reconciled", () => {
    expect(
      portfolioMatchingCoverageSchema.parse({
        eligibleReleases: 2,
        evaluatedReleases: 1,
        pendingReleases: 1,
      }),
    ).toBeDefined();
    expect(
      portfolioMatchingCoverageSchema.safeParse({
        eligibleReleases: 2,
        evaluatedReleases: 1,
        pendingReleases: 0,
      }).success,
    ).toBe(false);
    expect(
      portfolioMatchingCoverageSchema.safeParse({
        eligibleReleases: 2,
        evaluatedReleases: 3,
        pendingReleases: -1,
      }).success,
    ).toBe(false);
    expect(
      portfolioProductsResponseSchema.safeParse({
        ...base,
        products: withheld,
        matchingCoverage: {
          ...withheld,
          data: {
            eligibleReleases: 0,
            evaluatedReleases: 0,
            pendingReleases: 0,
          },
        },
      }).success,
    ).toBe(false);
  });
  it("requires actual versioned shared identities and distinct counts", () => {
    expect(portfolioConcentrationRowSchema.parse(component)).toEqual(component);
    for (const change of [
      { packageIdentity: "same-name" },
      { version: " " },
      { productCount: 1 },
      { releaseCount: 1 },
      { componentRef: "bad/ref" },
      { arbitrarySql: "select" },
    ])
      expect(
        portfolioConcentrationRowSchema.safeParse({ ...component, ...change })
          .success,
      ).toBe(false);
  });
  it("preserves the source normalized-version bound in list and detail identities", () => {
    const identity = {
      packageIdentity: component.packageIdentity,
      version: "v".repeat(1024),
      componentRef: component.componentRef,
      productCount: component.productCount,
      releaseCount: component.releaseCount,
    };
    expect(portfolioComponentSchema.parse(identity).version).toHaveLength(1024);
    expect(
      portfolioConcentrationRowSchema.parse({ ...identity, findings: withheld })
        .version,
    ).toHaveLength(1024);
    expect(
      portfolioComponentSchema.safeParse({
        ...identity,
        version: "v".repeat(1025),
      }).success,
    ).toBe(false);
    expect(
      portfolioConcentrationRowSchema.safeParse({
        ...identity,
        findings: withheld,
        version: "v".repeat(1025),
      }).success,
    ).toBe(false);
  });
  it("rejects withheld-section disclosure and private envelope additions", () => {
    const products = { ...base, products: withheld };
    expect(portfolioProductsResponseSchema.parse(products)).toEqual(products);
    expect(
      portfolioProductsResponseSchema.safeParse({ ...products, secret: true })
        .success,
    ).toBe(false);
    for (const state of ["restricted", "unavailable", "not_initialized"])
      expect(
        portfolioProductsResponseSchema.safeParse({
          ...products,
          products: {
            ...withheld,
            state,
            data: { rows: [], nextCursor: null },
          },
        }).success,
      ).toBe(false);
    expect(
      portfolioConcentrationResponseSchema.parse({
        ...base,
        concentration: withheld,
      }),
    ).toBeDefined();
    const identity = {
      packageIdentity: component.packageIdentity,
      version: component.version,
      componentRef: component.componentRef,
      productCount: component.productCount,
      releaseCount: component.releaseCount,
    };
    expect(
      portfolioDetailResponseSchema.parse({
        ...base,
        component: identity,
        affectedReleases: withheld,
      }),
    ).toBeDefined();
  });
  it("parses operational product and release evidence in bounded pages", () => {
    const section = (data: unknown) => ({
      state: "available",
      observedAt: now,
      updatedAt: now,
      data,
    });
    const product = {
      productId: id,
      productName: "Product",
      archived: false,
      classification: null,
      support: { state: "missing", startsAt: null, endsAt: null },
      legalEntityId: null,
      legalEntityName: null,
      sbomCoverage: section({
        eligibleReleases: 0,
        coveredReleases: 0,
        percent: null,
      }),
      findings: withheld,
      readiness: withheld,
    };
    expect(
      portfolioProductsResponseSchema.parse({
        ...base,
        products: section({ rows: [product], nextCursor: null }),
      }),
    ).toBeDefined();
    expect(
      portfolioProductsResponseSchema.safeParse({
        ...base,
        products: section({
          rows: [{ ...product, legalEntityId: id }],
          nextCursor: null,
        }),
      }).success,
    ).toBe(false);
    expect(
      portfolioConcentrationResponseSchema.parse({
        ...base,
        concentration: section({ rows: [component], nextCursor: "next" }),
      }),
    ).toBeDefined();
    expect(
      portfolioConcentrationResponseSchema.safeParse({
        ...base,
        concentration: section({
          rows: Array(101).fill(component),
          nextCursor: null,
        }),
      }).success,
    ).toBe(false);
    const identity = {
      packageIdentity: component.packageIdentity,
      version: component.version,
      componentRef: component.componentRef,
      productCount: component.productCount,
      releaseCount: component.releaseCount,
    };
    expect(
      portfolioDetailResponseSchema.parse({
        ...base,
        component: identity,
        affectedReleases: section({
          rows: [
            {
              productId: id,
              productName: "Product",
              archived: false,
              legalEntityId: id,
              legalEntityName: "Entity",
              releaseId: id,
              releaseVersion: "1",
              releaseArchived: false,
              findings: withheld,
            },
          ],
          nextCursor: null,
        }),
      }),
    ).toBeDefined();
  });
});
