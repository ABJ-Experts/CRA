import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import {
  operatorInstanceMetadataQuerySchema,
  operatorInstanceMetadataResponseSchema,
  operatorEmptyQuerySchema,
  operatorInstanceParamsSchema,
  operatorInstanceResponseSchema,
  operatorInstancesQuerySchema,
  operatorInstancesResponseSchema,
  operatorSessionResponseSchema,
  operatorTenantsQuerySchema,
  operatorTenantsResponseSchema,
} from "@repo/contracts";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodQuery, zodParams } from "../common/pipes/zod-validation.pipe";
import type { OperatorRequest } from "./operator-request";
export type { OperatorRequest } from "./operator-request";
import { OperatorRegistry } from "./operator-registry";

import type {
  OperatorEmptyQuery,
  OperatorInstanceParams,
  OperatorInstancesQuery,
  OperatorTenantsQuery,
  OperatorInstanceMetadataQuery,
} from "@repo/contracts";
import {
  OperatorScopeError,
  OperatorCursorError,
} from "./domain/operator-errors";
async function httpBoundary<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof OperatorScopeError)
      throw new NotFoundException("Operator instance unavailable");
    if (error instanceof OperatorCursorError)
      throw new BadRequestException("Invalid operator cursor");
    throw error;
  }
}
import { OperatorScoped } from "./operator-scoped.decorator";
export const OPERATOR_INSTANCE_ID = Symbol("operator-instance-id");
@OperatorScoped(
  "Verified raw mTLS fingerprint and fresh mounted explicit metadata scopes",
)
@Controller("operator")
export class OperatorController {
  constructor(
    @Inject(OperatorRegistry)
    private readonly registry: OperatorRegistry,
    @Inject(OPERATOR_INSTANCE_ID) private readonly instanceId: string,
  ) {}
  @Get("session")
  @ZodResponse(operatorSessionResponseSchema)
  session(
    @Req() request: OperatorRequest,
    @Query(zodQuery(operatorEmptyQuerySchema))
    query: OperatorEmptyQuery,
  ) {
    void query;
    return {
      schemaVersion: 1,
      principalId: request.operatorIdentity.principalId,
      grantRevision: request.operatorIdentity.revision,
      allowedInstanceIds: request.operatorIdentity.instanceIds,
    };
  }
  @Get("instances")
  @ZodResponse(operatorInstancesResponseSchema)
  instances(
    @Req() request: OperatorRequest,
    @Query(zodQuery(operatorInstancesQuerySchema))
    query: OperatorInstancesQuery,
  ) {
    return httpBoundary(() =>
      this.registry.list(request.operatorIdentity, query),
    );
  }
  @Get("instances/:instanceId")
  @ZodResponse(operatorInstanceResponseSchema)
  detail(
    @Req() request: OperatorRequest,
    @Param(zodParams(operatorInstanceParamsSchema))
    params: OperatorInstanceParams,
    @Query(zodQuery(operatorEmptyQuerySchema))
    query: OperatorEmptyQuery,
  ) {
    void query;
    return httpBoundary(() =>
      this.registry.detail(request.operatorIdentity, params.instanceId),
    );
  }
  @Get("instances/:instanceId/tenants")
  @ZodResponse(operatorTenantsResponseSchema)
  tenants(
    @Req() request: OperatorRequest,
    @Param(zodParams(operatorInstanceParamsSchema))
    params: OperatorInstanceParams,
    @Query(zodQuery(operatorTenantsQuerySchema))
    query: OperatorTenantsQuery,
  ) {
    return httpBoundary(() =>
      this.registry.tenants(request.operatorIdentity, params.instanceId, query),
    );
  }
  @Get("instance-metadata")
  @ZodResponse(operatorInstanceMetadataResponseSchema)
  metadata(
    @Req() request: OperatorRequest,
    @Query(zodQuery(operatorInstanceMetadataQuerySchema))
    query: OperatorInstanceMetadataQuery,
  ) {
    return httpBoundary(() =>
      this.registry.metadata(request.operatorIdentity, this.instanceId, query),
    );
  }
}
