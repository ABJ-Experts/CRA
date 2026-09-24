import { describe, expect, it } from "vitest";

import {
  frameworkPackImportSchema,
  frameworkRequirementReferenceSchema,
  frameworkTreeResponseSchema,
  selectFrameworkInputSchema,
} from "../index.js";

const basePack = {
  schemaVersion: 1,
  packKey: "cra-annex-i",
  versionKey: "2024-11-20.1",
  title: "CRA Annex I",
  editionDate: "2024-11-20",
  language: "en",
  sourceUrl:
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847",
  sourceCelex: "32024R2847",
  sourceEli: "http://data.europa.eu/eli/reg/2024/2847/oj",
  sourcePublicationDate: "2024-11-20",
  attribution: "European Union, Regulation (EU) 2024/2847",
  reviewEvidence:
    "Reviewed against the 20 November 2024 Official Journal edition",
  requirements: [
    {
      requirementKey: "part-i",
      identifier: "Part I",
      parentKey: null,
      position: 1,
      heading: "Part I",
      text: "Essential cybersecurity requirements",
      sourceReference: "Annex I, Part I",
    },
    {
      requirementKey: "part-i.1",
      identifier: "1",
      parentKey: "part-i",
      position: 1,
      heading: null,
      text: "A legal requirement",
      sourceReference: "Annex I, Part I, point 1",
    },
  ],
} as const;

describe("framework pack import", () => {
  it("accepts a bounded, versioned tree and stable reference", () => {
    expect(frameworkPackImportSchema.safeParse(basePack).success).toBe(true);
    expect(
      frameworkRequirementReferenceSchema.safeParse({
        packKey: "cra-annex-i",
        versionKey: "2024-11-20.1",
        requirementKey: "part-i.1",
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate keys, missing parents, cycles and repeated sibling positions", () => {
    const [root, child] = basePack.requirements;
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [root, child, child],
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [root, { ...child, parentKey: "absent" }],
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [{ ...root, parentKey: child.requirementKey }, child],
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [
          root,
          child,
          { ...child, requirementKey: "part-i.2", position: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [
          root,
          child,
          { ...child, requirementKey: "part-i.2", position: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps stable keys when an edition changes human-readable wording", () => {
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        versionKey: "2025-01-01.1",
        requirements: [
          basePack.requirements[0],
          {
            ...basePack.requirements[1],
            heading: "Renamed heading",
            text: "Revised text",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("matches database position, text and depth bounds", () => {
    const leaf = basePack.requirements[1];
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [
          basePack.requirements[0],
          { ...leaf, position: 10_000, text: "x".repeat(20_000) },
        ],
      }).success,
    ).toBe(true);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [basePack.requirements[0], { ...leaf, position: 10_001 }],
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [
          basePack.requirements[0],
          { ...leaf, text: "x".repeat(20_001) },
        ],
      }).success,
    ).toBe(false);
    const chain = Array.from({ length: 10 }, (_, index) => ({
      requirementKey: `n-${index}`,
      identifier: `Annex I, node ${index}`,
      parentKey: index === 0 ? null : `n-${index - 1}`,
      position: 1,
      heading: null,
      text: "Text",
      sourceReference: `Annex I, ${index}`,
    }));
    expect(
      frameworkPackImportSchema.safeParse({ ...basePack, requirements: chain })
        .success,
    ).toBe(true);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [
          ...chain,
          {
            ...chain[0],
            requirementKey: "n-10",
            identifier: "Annex I, node 10",
            parentKey: "n-9",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported schemas, dangerous controls and excessive depth", () => {
    expect(
      frameworkPackImportSchema.safeParse({ ...basePack, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        sourceUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        sourceEli: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...basePack,
        requirements: [
          { ...basePack.requirements[0], text: "<script>alert(1)</script>" },
        ],
      }).success,
    ).toBe(false);
    const chain = Array.from({ length: 13 }, (_, index) => ({
      requirementKey: `n-${index}`,
      identifier: `${index}`,
      parentKey: index === 0 ? null : `n-${index - 1}`,
      position: 1,
      heading: null,
      text: "Text",
      sourceReference: `Annex I, ${index}`,
    }));
    expect(
      frameworkPackImportSchema.safeParse({ ...basePack, requirements: chain })
        .success,
    ).toBe(false);
  });
});

describe("framework API", () => {
  it("requires optimistic revision and an idempotency key", () => {
    expect(
      selectFrameworkInputSchema.safeParse({
        versionKey: "2024-11-20.1",
        enabled: true,
        expectedRevision: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      selectFrameworkInputSchema.safeParse({
        versionKey: "2024-11-20.1",
        enabled: true,
        expectedRevision: 0,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
    expect(
      selectFrameworkInputSchema.safeParse({
        versionKey: "2024-11-20.1",
        enabled: true,
        expectedRevision: -1,
        idempotencyKey: "bad",
      }).success,
    ).toBe(false);
  });

  it("preserves text as data and requires bounded page metadata", () => {
    expect(
      frameworkTreeResponseSchema.safeParse({
        packKey: "cra-annex-i",
        versionKey: "2024-11-20.1",
        editionDate: "2024-11-20",
        language: "en",
        requirements: [{ ...basePack.requirements[0], depth: 0 }],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });
});
