import * as schemas from "@repo/contracts/audit/schemas";
import type {
  SiemCreateDestination,
  SiemUpdateDestination,
  SiemOperation,
  SiemCredentialInput,
  SiemPageQuery,
  SiemReplayInput,
} from "@repo/contracts/audit/types";
import { authenticatedRequestJson } from "../../../_lib/http/authenticated-request";
const root = "/api/v1/audit/siem";
function destination(id: string, suffix = ""): `/${string}` {
  return `${root}/destinations/${schemas.siemDestinationParamsSchema.parse({ id }).id}${suffix}`;
}
function delivery(id: string, deliveryId: string, suffix = ""): `/${string}` {
  const parsed = schemas.siemDeliveryParamsSchema.parse({ id, deliveryId });
  return destination(parsed.id, `/deliveries/${parsed.deliveryId}${suffix}`);
}
function read(path: `/${string}`, requestId: string): `/${string}` {
  return `${path}?${new URLSearchParams(schemas.siemReadQuerySchema.parse({ requestId }))}`;
}
/** JSON boundaries only. Secret commands are called directly, never cached as mutation variables. */
export class AuditSiemGateway {
  catalogue(requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: read(`${root}/catalogue`, requestId),
      schema: schemas.siemCatalogueSchema,
      signal,
    });
  }
  list(requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: read(`${root}/destinations`, requestId),
      schema: schemas.siemDestinationListSchema,
      signal,
    });
  }
  get(id: string, requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: read(destination(id), requestId),
      schema: schemas.siemDestinationSchema,
      signal,
    });
  }
  create(body: SiemCreateDestination) {
    return authenticatedRequestJson({
      path: `${root}/destinations`,
      method: "POST",
      body,
      inputSchema: schemas.siemCreateDestinationSchema,
      schema: schemas.siemDestinationSchema,
    });
  }
  update(id: string, body: SiemUpdateDestination) {
    return authenticatedRequestJson({
      path: destination(id),
      method: "PATCH",
      body,
      inputSchema: schemas.siemUpdateDestinationSchema,
      schema: schemas.siemDestinationSchema,
    });
  }
  credential(id: string, body: SiemCredentialInput) {
    return authenticatedRequestJson({
      path: destination(id, "/credentials"),
      method: "POST",
      body,
      inputSchema: schemas.siemCredentialInputSchema,
      schema: schemas.siemDestinationSchema,
    });
  }
  operation(
    id: string,
    operation: "enable" | "disable" | "credentials/revoke",
    body: SiemOperation,
  ) {
    return authenticatedRequestJson({
      path: destination(id, `/${operation}`),
      method: "POST",
      body,
      inputSchema: schemas.siemOperationSchema,
      schema: schemas.siemDestinationSchema,
    });
  }
  test(id: string, body: SiemOperation) {
    return authenticatedRequestJson({
      path: destination(id, "/test"),
      method: "POST",
      body,
      inputSchema: schemas.siemOperationSchema,
      schema: schemas.siemTestResultSchema,
    });
  }
  deliveries(id: string, input: SiemPageQuery, signal?: AbortSignal) {
    const query = schemas.siemPageQuerySchema.parse(input);
    const params = new URLSearchParams({
      requestId: query.requestId,
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return authenticatedRequestJson({
      path: `${destination(id, "/deliveries")}?${params}`,
      schema: schemas.siemDeliveryPageSchema,
      signal,
    });
  }
  detail(
    id: string,
    deliveryId: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: read(delivery(id, deliveryId), requestId),
      schema: schemas.siemDeliveryDetailSchema,
      signal,
    });
  }
  preview(id: string, deliveryId: string, body: SiemOperation) {
    return authenticatedRequestJson({
      path: delivery(id, deliveryId, "/replay-preview"),
      method: "POST",
      body,
      inputSchema: schemas.siemOperationSchema,
      schema: schemas.siemReplayPreviewSchema,
    });
  }
  replay(id: string, deliveryId: string, body: SiemReplayInput) {
    return authenticatedRequestJson({
      path: delivery(id, deliveryId, "/replay"),
      method: "POST",
      body,
      inputSchema: schemas.siemReplayInputSchema,
      schema: schemas.siemDeliverySchema,
    });
  }
}
export const auditSiemGateway = Object.freeze(new AuditSiemGateway());
