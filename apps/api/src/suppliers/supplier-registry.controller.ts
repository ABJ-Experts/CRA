import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  archiveSupplierContactInputSchema,
  archiveSupplierInputSchema,
  associateSupplierRequestInputSchema,
  createSupplierContactInputSchema,
  createSupplierInputSchema,
  createSupplierResponsibilityInputSchema,
  endSupplierResponsibilityInputSchema,
  findingResponsibleSuppliersParamsSchema,
  findingResponsibleSuppliersResponseSchema,
  supplierContactParamsSchema,
  supplierContactResponseSchema,
  supplierParamsSchema,
  supplierRequestParamsSchema,
  supplierResponsibilityParamsSchema,
  supplierResponsibilityResponseSchema,
  supplierResponseSchema,
  suppliersResponseSchema,
  supplierListQuerySchema,
  updateSupplierContactInputSchema,
  updateSupplierInputSchema,
  type ArchiveSupplierContactInput,
  type ArchiveSupplierInput,
  type AssociateSupplierRequestInput,
  type CreateSupplierContactInput,
  type CreateSupplierInput,
  type CreateSupplierResponsibilityInput,
  type EndSupplierResponsibilityInput,
  type FindingResponsibleSuppliersParams,
  type SupplierContactParams,
  type SupplierListQuery,
  type SupplierParams,
  type SupplierRequestParams,
  type SupplierResponsibilityParams,
  type UpdateSupplierContactInput,
  type UpdateSupplierInput,
} from "@repo/contracts/suppliers";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  SupplierRegistryConflictError,
  SupplierRegistryDuplicateCandidatesError,
  SupplierRegistryForbiddenError,
  SupplierRegistryInvalidRequestError,
  SupplierRegistryUseCases,
} from "./application/supplier-registry-use-cases";

/** Internal tenant registry. The supplier SBOM portal remains a separate public boundary. */
@Controller("suppliers")
export class SupplierRegistryController {
  constructor(private readonly suppliers: SupplierRegistryUseCases) {}

  @Get()
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_sboms",
  )
  @ZodResponse(suppliersResponseSchema)
  async list(
    @Query(zodQuery(supplierListQuerySchema)) query: SupplierListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        suppliers: await this.suppliers.listSuppliers(organizationId(user), {
          actorId: user.id,
          ...query,
        }),
      };
    } catch (error) {
      throw readFailure(error);
    }
  }

  @Post()
  @RequirePermissions("can_view_suppliers", "can_manage_suppliers")
  @ZodResponse(supplierResponseSchema)
  async create(
    @Body(zodBody(createSupplierInputSchema)) input: CreateSupplierInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        supplier: await this.suppliers.createSupplier(organizationId(user), {
          actorId: user.id,
          ...input,
        }),
      };
    } catch (error) {
      throw mutationFailure(error);
    }
  }

  @Get(":supplierId")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_sboms",
  )
  @ZodResponse(supplierResponseSchema)
  async detail(
    @Param(zodParams(supplierParamsSchema)) params: SupplierParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const supplier = await this.suppliers.getSupplier(organizationId(user), {
        actorId: user.id,
        supplierId: params.supplierId,
      });
      if (supplier) return { supplier };
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }

  @Patch(":supplierId")
  @RequirePermissions("can_view_suppliers", "can_manage_suppliers")
  @ZodResponse(supplierResponseSchema)
  async update(
    @Param(zodParams(supplierParamsSchema)) params: SupplierParams,
    @Body(zodBody(updateSupplierInputSchema)) input: UpdateSupplierInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const supplier = await this.suppliers.updateSupplier(
        organizationId(user),
        {
          actorId: user.id,
          supplierId: params.supplierId,
          ...input,
        },
      );
      if (supplier) return { supplier };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":supplierId/archive")
  @RequirePermissions("can_view_suppliers", "can_manage_suppliers")
  @ZodResponse(supplierResponseSchema)
  async archive(
    @Param(zodParams(supplierParamsSchema)) params: SupplierParams,
    @Body(zodBody(archiveSupplierInputSchema)) input: ArchiveSupplierInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const supplier = await this.suppliers.archiveSupplier(
        organizationId(user),
        {
          actorId: user.id,
          supplierId: params.supplierId,
          ...input,
        },
      );
      if (supplier) return { supplier };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":supplierId/contacts")
  @RequirePermissions("can_view_suppliers", "can_manage_suppliers")
  @ZodResponse(supplierContactResponseSchema)
  async createContact(
    @Param(zodParams(supplierParamsSchema)) params: SupplierParams,
    @Body(zodBody(createSupplierContactInputSchema))
    input: CreateSupplierContactInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const contact = await this.suppliers.createContact(organizationId(user), {
        actorId: user.id,
        supplierId: params.supplierId,
        ...input,
      });
      if (contact) return { contact };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Patch(":supplierId/contacts/:contactId")
  @RequirePermissions("can_view_suppliers", "can_manage_suppliers")
  @ZodResponse(supplierContactResponseSchema)
  async updateContact(
    @Param(zodParams(supplierContactParamsSchema))
    params: SupplierContactParams,
    @Body(zodBody(updateSupplierContactInputSchema))
    input: UpdateSupplierContactInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const contact = await this.suppliers.updateContact(organizationId(user), {
        actorId: user.id,
        ...params,
        ...input,
      });
      if (contact) return { contact };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":supplierId/contacts/:contactId/archive")
  @RequirePermissions("can_view_suppliers", "can_manage_suppliers")
  @ZodResponse(supplierContactResponseSchema)
  async archiveContact(
    @Param(zodParams(supplierContactParamsSchema))
    params: SupplierContactParams,
    @Body(zodBody(archiveSupplierContactInputSchema))
    input: ArchiveSupplierContactInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const contact = await this.suppliers.archiveContact(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (contact) return { contact };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":supplierId/responsibilities")
  @RequirePermissions(
    "can_view_suppliers",
    "can_manage_suppliers",
    "can_view_products",
    "can_view_sboms",
  )
  @ZodResponse(supplierResponsibilityResponseSchema)
  async createResponsibility(
    @Param(zodParams(supplierParamsSchema)) params: SupplierParams,
    @Body(zodBody(createSupplierResponsibilityInputSchema))
    input: CreateSupplierResponsibilityInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const responsibility = await this.suppliers.createResponsibility(
        organizationId(user),
        { actorId: user.id, supplierId: params.supplierId, ...input },
      );
      if (responsibility) return { responsibility };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":supplierId/responsibilities/:responsibilityId/end")
  @RequirePermissions(
    "can_view_suppliers",
    "can_manage_suppliers",
    "can_view_products",
    "can_view_sboms",
  )
  @ZodResponse(supplierResponsibilityResponseSchema)
  async endResponsibility(
    @Param(zodParams(supplierResponsibilityParamsSchema))
    params: SupplierResponsibilityParams,
    @Body(zodBody(endSupplierResponsibilityInputSchema))
    input: EndSupplierResponsibilityInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const responsibility = await this.suppliers.endResponsibility(
        organizationId(user),
        { actorId: user.id, ...params, ...input },
      );
      if (responsibility) return { responsibility };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }

  @Post(":supplierId/requests/:requestId")
  @RequirePermissions(
    "can_view_suppliers",
    "can_manage_suppliers",
    "can_view_products",
    "can_view_sboms",
  )
  @ZodResponse(supplierResponseSchema)
  async associateRequest(
    @Param(zodParams(supplierRequestParamsSchema))
    params: SupplierRequestParams,
    @Body(zodBody(associateSupplierRequestInputSchema))
    input: AssociateSupplierRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const supplier = await this.suppliers.associateRequest(
        organizationId(user),
        {
          actorId: user.id,
          ...params,
          ...input,
        },
      );
      if (supplier) return { supplier };
    } catch (error) {
      throw mutationFailure(error);
    }
    throw notFound();
  }
}

/** Registered in FindingsModule before its generic :findingId controller routes. */
@Controller("findings")
export class FindingResponsibleSuppliersController {
  constructor(private readonly suppliers: SupplierRegistryUseCases) {}

  @Get(":findingId/responsible-suppliers")
  @RequirePermissions(
    "can_view_findings",
    "can_view_suppliers",
    "can_view_products",
    "can_view_sboms",
  )
  @ZodResponse(findingResponsibleSuppliersResponseSchema)
  async resolve(
    @Param(zodParams(findingResponsibleSuppliersParamsSchema))
    params: FindingResponsibleSuppliersParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const resolution = await this.suppliers.findingResponsibleSuppliers(
        organizationId(user),
        { actorId: user.id, findingId: params.findingId },
      );
      if (resolution) return { resolution };
    } catch (error) {
      throw readFailure(error);
    }
    throw notFound();
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw notFound();
}

function notFound(): NotFoundException {
  return new NotFoundException({
    message: "Supplier registry record was not found.",
    code: "not_found",
  });
}

function readFailure(error: unknown): Error {
  if (error instanceof SupplierRegistryForbiddenError)
    return new ForbiddenException({ code: "forbidden" });
  if (error instanceof SupplierRegistryInvalidRequestError)
    return new ConflictException({ code: "invalid_request" });
  return new ServiceUnavailableException({
    message: "Supplier registry data is temporarily unavailable.",
    code: "unavailable",
  });
}

function mutationFailure(error: unknown): Error {
  if (error instanceof SupplierRegistryDuplicateCandidatesError)
    return new ConflictException({
      message:
        "Confirm the listed same-name suppliers before creating another.",
      code: "duplicate_confirmation_required",
      details: { candidates: error.candidates },
    });
  if (error instanceof SupplierRegistryForbiddenError)
    return new ForbiddenException({ code: "forbidden" });
  if (
    error instanceof SupplierRegistryConflictError ||
    error instanceof SupplierRegistryInvalidRequestError
  )
    return new ConflictException({
      message: "The supplier registry changed. Refresh and retry.",
      code: "conflict",
    });
  return new ServiceUnavailableException({
    message: "Supplier registry changes are temporarily unavailable.",
    code: "unavailable",
  });
}
