import { z } from "zod";

const targetKey = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
const hostname = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i);
const httpsUrl = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      context.addIssue({
        code: "custom",
        message: "Target URLs must be plain default-port HTTPS URLs.",
      });
    }
  });

const storageTargetSchema = z
  .object({
    targetKey,
    label: z.string().trim().min(1).max(200),
    kind: z.literal("supabase_storage"),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    prefix: z.string().regex(/^[a-z0-9][a-z0-9/_-]{0,200}$/),
  })
  .strict();
const httpsTargetSchema = z
  .object({
    targetKey,
    label: z.string().trim().min(1).max(200),
    kind: z.enum(["https_put", "well_known"]),
    versionedUrlTemplate: httpsUrl.refine(
      (value) =>
        value.includes("{organizationId}") && value.includes("{sha256}"),
      "Versioned URL needs organizationId and sha256 placeholders.",
    ),
    pointerUrl: httpsUrl,
    allowedHosts: z.array(hostname).min(1).max(20),
    credentialEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
      .optional(),
  })
  .strict()
  .superRefine((target, context) => {
    const hosts = new Set(
      target.allowedHosts.map((value) => value.toLowerCase()),
    );
    const urls = [target.versionedUrlTemplate, target.pointerUrl].map(
      (value) => new URL(value),
    );
    if (urls.some((url) => !hosts.has(url.hostname.toLowerCase()))) {
      context.addIssue({
        code: "custom",
        message: "Every publication URL host must be allowlisted.",
      });
    }
    if (
      target.kind === "well_known" &&
      !new URL(target.pointerUrl).pathname.startsWith("/.well-known/")
    ) {
      context.addIssue({
        code: "custom",
        path: ["pointerUrl"],
        message: "A well-known target pointer must be under /.well-known/.",
      });
    }
  });

const registrySchema = z
  .array(z.union([storageTargetSchema, httpsTargetSchema]))
  .max(100)
  .superRefine((targets, context) => {
    if (
      new Set(targets.map((target) => target.targetKey)).size !== targets.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Publication target keys must be unique.",
      });
    }
  });

export type ConfiguredVexPublicationTarget = z.output<
  typeof registrySchema
>[number];

/** Deployment configuration only; endpoint and credential values never enter DB or HTTP projections. */
export class ConfiguredVexPublicationTargetRegistry {
  private readonly targets: ReadonlyMap<string, ConfiguredVexPublicationTarget>;

  constructor(raw: string | undefined) {
    let value: unknown = [];
    if (raw?.trim()) {
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        throw new Error(
          "invalid VEX publication target registry configuration",
        );
      }
    }
    const parsed = registrySchema.safeParse(value);
    if (!parsed.success)
      throw new Error("invalid VEX publication target registry configuration");
    this.targets = new Map(
      parsed.data.map((target) => [target.targetKey, Object.freeze(target)]),
    );
  }

  list(): readonly ConfiguredVexPublicationTarget[] {
    return Object.freeze([...this.targets.values()]);
  }
  find(targetKey: string): ConfiguredVexPublicationTarget | null {
    return this.targets.get(targetKey) ?? null;
  }
}
