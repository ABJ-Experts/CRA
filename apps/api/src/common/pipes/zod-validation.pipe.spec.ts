import { BadRequestException } from "@nestjs/common";
import { z, ZodError } from "zod";

import {
  toBadRequest,
  ZodValidationPipe,
  zodBody,
} from "./zod-validation.pipe";

describe("ZodValidationPipe", () => {
  const schema = z.object({
    profile: z.object({
      email: z.email("Enter a valid email address"),
    }),
  });

  it("returns parsed and transformed data", () => {
    const pipe = new ZodValidationPipe(
      z.object({ name: z.string().trim(), count: z.coerce.number() }),
    );

    expect(pipe.transform({ name: "  Ada  ", count: "3" })).toEqual({
      name: "Ada",
      count: 3,
    });
  });

  it("throws the API validation shape for invalid nested input", () => {
    const pipe = zodBody(schema);

    expect(() =>
      pipe.transform({ profile: { email: "not-an-email" } }),
    ).toThrow(BadRequestException);

    try {
      pipe.transform({ profile: { email: "not-an-email" } });
    } catch (caught) {
      expect((caught as BadRequestException).getResponse()).toEqual({
        message: "Enter a valid email address",
        code: "validation_failed",
        fieldErrors: {
          "profile.email": "Enter a valid email address",
        },
      });
    }
  });

  it("keeps only the first error for each rendered field", () => {
    const repeatedFieldSchema = z.string().superRefine((_value, context) => {
      context.addIssue({ code: "custom", message: "First message" });
      context.addIssue({ code: "custom", message: "Second message" });
    });
    const result = repeatedFieldSchema.safeParse("value");
    if (result.success) throw new Error("Expected validation to fail");

    expect(toBadRequest(result.error)).toEqual({
      message: "First message",
      code: "validation_failed",
      fieldErrors: {},
    });
  });

  it("falls back safely for a Zod error without issues", () => {
    expect(toBadRequest(new ZodError([]))).toEqual({
      message: "That input is not valid.",
      code: "validation_failed",
      fieldErrors: {},
    });
  });
});
