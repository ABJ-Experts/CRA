import { z } from "zod";

export const sbomExportQuerySchema = z
  .object({
    sourceId: z.uuid(),
    format: z.enum(["cyclonedx", "spdx"]),
    includeVex: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.format === "spdx" && input.includeVex)
      context.addIssue({
        code: "custom",
        path: ["includeVex"],
        message:
          "Embedded VEX is supported only in CycloneDX 1.6; SPDX 2.3 has no native VEX representation.",
      });
  });

export const sbomExportResponseSchema = z
  .object({
    export: z
      .object({
        documentId: z.uuid(),
        sourceId: z.uuid(),
        format: z.enum(["cyclonedx", "spdx"]),
        specificationVersion: z.enum(["1.6", "2.3"]),
        fileName: z.string().regex(/^sbom-[a-f0-9-]+\.(cdx|spdx)\.json$/u),
        mediaType: z.enum([
          "application/vnd.cyclonedx+json",
          "application/spdx+json",
        ]),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        content: z
          .string()
          .min(2)
          .max(50 * 1024 * 1024),
        vex: z
          .object({
            status: z.enum(["not_requested", "included"]),
            assessmentCount: z.number().int().min(0).max(50_000),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ export: result }, context) => {
    if (
      (result.format === "cyclonedx") !==
        (result.specificationVersion === "1.6") ||
      (result.format === "cyclonedx") !==
        (result.mediaType === "application/vnd.cyclonedx+json")
    )
      context.addIssue({
        code: "custom",
        path: ["export", "format"],
        message: "Format metadata must match the serialized specification",
      });
    if (
      (result.vex.status === "not_requested" &&
        result.vex.assessmentCount !== 0) ||
      (result.vex.status === "included" &&
        (result.format !== "cyclonedx" || result.vex.assessmentCount === 0))
    )
      context.addIssue({
        code: "custom",
        path: ["export", "vex"],
        message: "VEX metadata must describe included reviewed assessments",
      });
  });
