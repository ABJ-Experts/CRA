# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m9-06-supplier-sbom-portal.spec.ts >> assigned supplier uploads, corrects, and reviews an SBOM through the M9 link
- Location: e2e/m9-06-supplier-sbom-portal.spec.ts:311:1

# Error details

```
Error: {"statusCode":409,"message":"The supplier evidence request changed. Refresh and retry.","code":"conflict"}

expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 409
```

# Test source

```ts
  1   | import { execFile } from "node:child_process";
  2   | import { randomUUID } from "node:crypto";
  3   | import { dirname, resolve } from "node:path";
  4   | import { fileURLToPath } from "node:url";
  5   | import { promisify } from "node:util";
  6   | 
  7   | import { expect, test, type APIRequestContext } from "@playwright/test";
  8   | 
  9   | import { LIVE_API_ORIGIN, signIn } from "./helpers/accounts";
  10  | 
  11  | /* eslint-disable turbo/no-undeclared-env-vars -- This opt-in live browser test runs outside Turbo. */
  12  | 
  13  | const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
  14  | const MAILPIT_ORIGIN =
  15  |   process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
  16  | const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  17  | const API = `${LIVE_API_ORIGIN}/api/v1`;
  18  | const execFileAsync = promisify(execFile);
  19  | 
  20  | type Session = { user: { id: string } };
  21  | type LegalEntities = {
  22  |   legalEntities: Array<{
  23  |     id: string;
  24  |     identifier: string | null;
  25  |     status: string;
  26  |     completionStatus: string;
  27  |   }>;
  28  | };
  29  | type IdResponse<T extends string> = Record<T, { id: string }>;
  30  | type EvidenceRequest = {
  31  |   request: {
  32  |     id: string;
  33  |     version: number;
  34  |     currentRevision: { id: string };
  35  |     activeInvitation: { id: string } | null;
  36  |   };
  37  | };
  38  | type SupplierSubmission = {
  39  |   id: string;
  40  |   sourceId: string | null;
  41  |   state: string;
  42  | };
  43  | 
  44  | function assertLocalOrigins(): void {
  45  |   for (const origin of [WEB_ORIGIN, LIVE_API_ORIGIN, MAILPIT_ORIGIN]) {
  46  |     const host = new URL(origin).hostname;
  47  |     if (host !== "localhost" && host !== "127.0.0.1") {
  48  |       throw new Error(
  49  |         `M9-06 browser test refuses a non-local origin: ${origin}`,
  50  |       );
  51  |     }
  52  |   }
  53  | }
  54  | 
  55  | async function json<T>(
  56  |   response: Awaited<ReturnType<APIRequestContext["get"]>>,
  57  |   expected: number,
  58  | ): Promise<T> {
  59  |   const body = await response.text();
> 60  |   expect(response.status(), body).toBe(expected);
      |                                   ^ Error: {"statusCode":409,"message":"The supplier evidence request changed. Refresh and retry.","code":"conflict"}
  61  |   return JSON.parse(body) as T;
  62  | }
  63  | 
  64  | async function ownerIdentity(request: APIRequestContext) {
  65  |   const session = await json<Session>(
  66  |     await request.get(`${API}/auth/session`),
  67  |     200,
  68  |   );
  69  |   const entities = await json<LegalEntities>(
  70  |     await request.get(`${API}/organizations/current/legal-entities`),
  71  |     200,
  72  |   );
  73  |   const legalEntity = entities.legalEntities.find(
  74  |     (candidate) =>
  75  |       candidate.identifier === "default" &&
  76  |       candidate.status === "active" &&
  77  |       candidate.completionStatus === "complete",
  78  |   );
  79  |   if (!legalEntity)
  80  |     throw new Error("Local owner fixture lacks a default legal entity");
  81  |   return { ownerId: session.user.id, legalEntityId: legalEntity.id };
  82  | }
  83  | 
  84  | async function issuedFixture(request: APIRequestContext, runId: string) {
  85  |   const { ownerId, legalEntityId } = await ownerIdentity(request);
  86  |   const supplierName = `M9-06 supplier ${runId}`;
  87  |   const contactEmail = `m906-${runId}@cra.test`;
  88  |   const supplier = await json<IdResponse<"supplier">>(
  89  |     await request.post(`${API}/suppliers`, {
  90  |       data: {
  91  |         name: supplierName,
  92  |         criticality: "medium",
  93  |         duplicateCandidateIdsConfirmed: [],
  94  |         idempotencyKey: randomUUID(),
  95  |       },
  96  |     }),
  97  |     201,
  98  |   );
  99  |   const contact = await json<IdResponse<"contact">>(
  100 |     await request.post(`${API}/suppliers/${supplier.supplier.id}/contacts`, {
  101 |       data: {
  102 |         name: "M9-06 supplier contact",
  103 |         email: contactEmail,
  104 |         idempotencyKey: randomUUID(),
  105 |       },
  106 |     }),
  107 |     201,
  108 |   );
  109 |   const product = await json<IdResponse<"product">>(
  110 |     await request.post(`${API}/products`, {
  111 |       data: {
  112 |         name: `M9-06 product ${runId}`,
  113 |         internalCode: `M906-${runId}`,
  114 |         productType: "standalone_software",
  115 |         responsibleOwnerId: ownerId,
  116 |         legalEntityId,
  117 |         idempotencyKey: randomUUID(),
  118 |       },
  119 |     }),
  120 |     201,
  121 |   );
  122 |   const release = await json<IdResponse<"release">>(
  123 |     await request.post(`${API}/products/${product.product.id}/releases`, {
  124 |       data: {
  125 |         label: `M9-06 release ${runId}`,
  126 |         version: "1.0.0",
  127 |         idempotencyKey: randomUUID(),
  128 |       },
  129 |     }),
  130 |     201,
  131 |   );
  132 |   const componentRef = `pkg:npm/m906-${runId}@1.0.0`;
  133 |   const expiresAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  134 |   const m3 = await json<IdResponse<"request">>(
  135 |     await request.post(
  136 |       `${API}/products/${product.product.id}/releases/${release.release.id}/supplier-sbom-requests`,
  137 |       {
  138 |         data: {
  139 |           productId: product.product.id,
  140 |           releaseId: release.release.id,
  141 |           supplierDisplayName: supplierName,
  142 |           allowedComponentRef: componentRef,
  143 |           expiresAt,
  144 |           idempotencyKey: randomUUID(),
  145 |         },
  146 |       },
  147 |     ),
  148 |     201,
  149 |   );
  150 |   await json(
  151 |     await request.post(
  152 |       `${API}/suppliers/${supplier.supplier.id}/requests/${m3.request.id}`,
  153 |       { data: { idempotencyKey: randomUUID() } },
  154 |     ),
  155 |     201,
  156 |   );
  157 |   const draft = {
  158 |     supplierId: supplier.supplier.id,
  159 |     productId: product.product.id,
  160 |     recipientContactId: contact.contact.id,
```