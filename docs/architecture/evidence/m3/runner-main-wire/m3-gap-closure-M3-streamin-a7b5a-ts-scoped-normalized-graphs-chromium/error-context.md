# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-gap-closure.spec.ts >> M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs
- Location: e2e/m3-gap-closure.spec.ts:173:1

# Error details

```
Error: Command failed: pnpm --filter api exec ts-node -r tsconfig-paths/register src/sbom-ingest-worker.ts --once
(node:43284) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:43285) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
[Nest] 43285  - 09/28/2026, 2:21:53 PM   ERROR [ExceptionHandler] Error: Invalid environment configuration:
  - WEB_ORIGIN: Invalid URL
    at Object.validateEnv [as validate] (/Users/abjmac003/Documents/GitHub/CRA/apps/api/src/config/env.validation.ts:440:11)
    at Function.forRoot (/Users/abjmac003/Documents/GitHub/CRA/node_modules/.pnpm/@nestjs+config@4.0.4_@nestjs+common@11.1.28_reflect-metadata@0.2.2_rxjs@7.8.2__rxjs@7.8.2/node_modules/@nestjs/config/dist/config.module.js:88:45)
    at Object.<anonymous> (/Users/abjmac003/Documents/GitHub/CRA/apps/api/src/app.module.ts:30:18)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Module.m._compile (/Users/abjmac003/Documents/GitHub/CRA/node_modules/.pnpm/ts-node@10.9.2_@swc+core@1.15.47_@types+node@24.13.3_typescript@5.9.2/node_modules/ts-node/src/index.ts:1618:23)
    at node:internal/modules/cjs/loader:1913:10
    at Object.require.extensions.<computed> [as .ts] (/Users/abjmac003/Documents/GitHub/CRA/node_modules/.pnpm/ts-node@10.9.2_@swc+core@1.15.47_@types+node@24.13.3_typescript@5.9.2/node_modules/ts-node/src/index.ts:1621:12)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)

```

# Test source

```ts
  340 |    * available in non-strict environments and is recorded in the audit trail.
  341 |    * Strict deployments quarantine instead, so an invalid value must fail boot.
  342 |    */
  343 |   BRANDING_SCANNER_STRICT: strictBoolean(false),
  344 |   /** ClamD is intentionally optional at API boot: absent/unreachable scanning
  345 |    * leaves newly uploaded evidence pending rather than making it usable. */
  346 |   EVIDENCE_CLAMAV_HOST: z.string().trim().min(1).optional(),
  347 |   EVIDENCE_CLAMAV_PORT: optionalBoundedInt(65_535, "must not exceed 65535"),
  348 |   EVIDENCE_CLAMAV_CONNECT_TIMEOUT_MS: boundedInt(
  349 |     3_000,
  350 |     30_000,
  351 |     "must not exceed 30000 milliseconds",
  352 |   ),
  353 |   EVIDENCE_CLAMAV_SCAN_TIMEOUT_MS: boundedInt(
  354 |     120_000,
  355 |     600_000,
  356 |     "must not exceed 600000 milliseconds",
  357 |   ),
  358 |   /** Local-only extraction. Empty paths intentionally make just OCR unavailable. */
  359 |   EVIDENCE_PDFTOTEXT_PATH: z.string().trim().min(1).max(1_024).optional(),
  360 |   EVIDENCE_PDFTOPPM_PATH: z.string().trim().min(1).max(1_024).optional(),
  361 |   EVIDENCE_TESSERACT_PATH: z.string().trim().min(1).max(1_024).optional(),
  362 |   EVIDENCE_OCR_LANGUAGE: z
  363 |     .string()
  364 |     .trim()
  365 |     .regex(/^[A-Za-z0-9_+-]{2,32}$/)
  366 |     .default("eng"),
  367 |   EVIDENCE_EXTRACTION_COMMAND_TIMEOUT_MS: boundedInt(
  368 |     30_000,
  369 |     300_000,
  370 |     "must not exceed 300000 milliseconds",
  371 |   ),
  372 |   EVIDENCE_EXTRACTION_JOB_TIMEOUT_MS: boundedInt(
  373 |     120_000,
  374 |     600_000,
  375 |     "must not exceed 600000 milliseconds",
  376 |   ),
  377 |   EVIDENCE_EXTRACTION_LEASE_SECONDS: boundedInt(
  378 |     120,
  379 |     900,
  380 |     "must not exceed 900 seconds",
  381 |   ),
  382 |   EVIDENCE_OCR_MAX_PIXELS: boundedInt(
  383 |     40_000_000,
  384 |     100_000_000,
  385 |     "must not exceed 100000000 pixels",
  386 |   ),
  387 |   // Supplier extraction is unavailable unless both local Ollama settings are
  388 |   // explicitly configured. Loopback-only prevents accidental cloud routing.
  389 |   AI_OLLAMA_URL: z
  390 |     .string()
  391 |     .url()
  392 |     .refine((value) => {
  393 |       const url = new URL(value);
  394 |       return (
  395 |         url.protocol === "http:" &&
  396 |         ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
  397 |         !url.username &&
  398 |         !url.password &&
  399 |         !url.search &&
  400 |         !url.hash &&
  401 |         (url.pathname === "/" || url.pathname === "")
  402 |       );
  403 |     }, "must be a loopback HTTP origin")
  404 |     .optional(),
  405 |   AI_OLLAMA_MODEL: z
  406 |     .string()
  407 |     .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/)
  408 |     .refine((value) => !value.endsWith(":latest"), "must be version-tagged")
  409 |     .optional(),
  410 |   AI_OLLAMA_TIMEOUT_MS: boundedInt(
  411 |     30_000,
  412 |     60_000,
  413 |     "must not exceed 60000 milliseconds",
  414 |   ),
  415 |   /**
  416 |    * Tolerance when comparing a JWT's `iat` against `users.session_epoch_at`.
  417 |    *
  418 |    * DEFAULTS TO 0, and that is deliberate. A positive skew opens a revocation
  419 |    * WINDOW: a token issued fewer than `skew` seconds before a sign-out survives
  420 |    * it, because `iat < epoch - skew` is false. The end-to-end flow caught
  421 |    * exactly that — "sign out everywhere" left the just-issued token working.
  422 |    *
  423 |    * The drift it was meant to absorb (GoTrue's clock vs Postgres's) only
  424 |    * matters for a session that should CONTINUE across an epoch bump, and the
  425 |    * only such flow is changing your password while signed in — which re-issues
  426 |    * cookies anyway. This is a fixed invariant rather than a tunable value.
  427 |    */
  428 |   SESSION_EPOCH_SKEW_SECONDS: fixedZero,
  429 | });
  430 | 
  431 | export type Env = z.infer<typeof envSchema>;
  432 | 
  433 | export function validateEnv(raw: Record<string, unknown>): Env {
  434 |   const parsed = envSchema.safeParse(raw);
  435 | 
  436 |   if (!parsed.success) {
  437 |     const detail = parsed.error.issues
  438 |       .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
  439 |       .join("\n");
> 440 |     throw new Error(`Invalid environment configuration:\n${detail}`);
      |           ^ Error: Command failed: pnpm --filter api exec ts-node -r tsconfig-paths/register src/sbom-ingest-worker.ts --once
  441 |   }
  442 | 
  443 |   if (
  444 |     parsed.data.VULNERABILITY_CSAF_INDEX_URL !== undefined &&
  445 |     parsed.data.VULNERABILITY_CSAF_ALLOWED_HOSTS.trim() === ""
  446 |   ) {
  447 |     throw new Error(
  448 |       "Invalid environment configuration:\n  - VULNERABILITY_CSAF_ALLOWED_HOSTS: is required when a CSAF index is configured",
  449 |     );
  450 |   }
  451 | 
  452 |   if (
  453 |     (parsed.data.AI_OLLAMA_URL === undefined) !==
  454 |     (parsed.data.AI_OLLAMA_MODEL === undefined)
  455 |   ) {
  456 |     throw new Error(
  457 |       "Invalid environment configuration:\n  - AI_OLLAMA_URL and AI_OLLAMA_MODEL: must be configured together",
  458 |     );
  459 |   }
  460 | 
  461 |   return parsed.data;
  462 | }
  463 | 
```