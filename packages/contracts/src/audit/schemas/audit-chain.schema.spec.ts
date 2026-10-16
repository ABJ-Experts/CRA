import { describe, expect, it } from "vitest";
import {
  auditChainRequestSchema,
  auditSequenceSchema,
} from "./audit-chain.schema.js";
const organizationId = "11111111-1111-4111-8111-111111111111";
describe("audit chain boundaries", () => {
  it("keeps bigint sequences as exact text", () => {
    expect(auditSequenceSchema.parse("9007199254740993")).toBe(
      "9007199254740993",
    );
    expect(auditSequenceSchema.parse("9223372036854775807")).toBe(
      "9223372036854775807",
    );
  });
  it.each(["-1", "01", "1.2", "1e2", "9223372036854775808"])(
    "rejects invalid PostgreSQL sequences %s",
    (value) => expect(auditSequenceSchema.safeParse(value).success).toBe(false),
  );
  it("requires explicit tenant and bounds memory/work options", () => {
    expect(auditChainRequestSchema.safeParse({}).success).toBe(false);
    expect(
      auditChainRequestSchema.safeParse({ organizationId, pageSize: 1001 })
        .success,
    ).toBe(false);
    expect(
      auditChainRequestSchema.safeParse({
        organizationId,
        fromSequence: "2",
        toSequence: "1",
      }).success,
    ).toBe(false);
    expect(auditChainRequestSchema.parse({ organizationId })).toMatchObject({
      pageSize: 250,
      maxEvents: 1000000,
      fromSequence: "1",
    });
  });
});
