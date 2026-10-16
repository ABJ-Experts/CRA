import type {
  ArchiveSupplierContactInput,
  ArchiveSupplierInput,
  AssociateSupplierRequestInput,
  CreateSupplierContactInput,
  CreateSupplierInput,
  CreateSupplierResponsibilityInput,
  EndSupplierResponsibilityInput,
  FindingResponsibleSuppliersResolution,
  SupplierContact,
  SupplierDetail,
  SupplierDuplicateCandidate,
  SupplierListQuery,
  SupplierResponsibility,
  SupplierSummary,
  UpdateSupplierContactInput,
  UpdateSupplierInput,
} from "@repo/contracts/suppliers";

export const SUPPLIER_REGISTRY_REPOSITORY = Symbol(
  "SUPPLIER_REGISTRY_REPOSITORY",
);

export class SupplierRegistryConflictError extends Error {}
export class SupplierRegistryForbiddenError extends Error {}
export class SupplierRegistryInvalidRequestError extends Error {}
export class SupplierRegistryDuplicateCandidatesError extends Error {
  constructor(readonly candidates: readonly SupplierDuplicateCandidate[]) {
    super("Supplier duplicate confirmation is required.");
  }
}

export interface SupplierRegistryRepository {
  listSuppliers(
    organizationId: string,
    input: Readonly<{ actorId: string } & SupplierListQuery>,
  ): Promise<
    Readonly<{ items: readonly SupplierSummary[]; nextCursor: string | null }>
  >;
  getSupplier(
    organizationId: string,
    input: Readonly<{ actorId: string; supplierId: string }>,
  ): Promise<SupplierDetail | null>;
  createSupplier(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateSupplierInput>,
  ): Promise<SupplierDetail>;
  updateSupplier(
    organizationId: string,
    input: Readonly<
      { actorId: string; supplierId: string } & UpdateSupplierInput
    >,
  ): Promise<SupplierDetail | null>;
  archiveSupplier(
    organizationId: string,
    input: Readonly<
      { actorId: string; supplierId: string } & ArchiveSupplierInput
    >,
  ): Promise<SupplierDetail | null>;
  createContact(
    organizationId: string,
    input: Readonly<
      { actorId: string; supplierId: string } & CreateSupplierContactInput
    >,
  ): Promise<SupplierContact | null>;
  updateContact(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        contactId: string;
      } & UpdateSupplierContactInput
    >,
  ): Promise<SupplierContact | null>;
  archiveContact(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        contactId: string;
      } & ArchiveSupplierContactInput
    >,
  ): Promise<SupplierContact | null>;
  createResponsibility(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
      } & CreateSupplierResponsibilityInput
    >,
  ): Promise<SupplierResponsibility | null>;
  endResponsibility(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        responsibilityId: string;
      } & EndSupplierResponsibilityInput
    >,
  ): Promise<SupplierResponsibility | null>;
  associateRequest(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        requestId: string;
      } & AssociateSupplierRequestInput
    >,
  ): Promise<SupplierDetail | null>;
  findingResponsibleSuppliers(
    organizationId: string,
    input: Readonly<{ actorId: string; findingId: string }>,
  ): Promise<FindingResponsibleSuppliersResolution | null>;
}

/**
 * Application boundary for the internal registry. The adapter owns atomic
 * database transitions; this layer deliberately carries the verified tenant
 * scope rather than reconstructing supplier or component identities.
 */
export class SupplierRegistryUseCases {
  constructor(private readonly repository: SupplierRegistryRepository) {}

  listSuppliers(
    organizationId: string,
    input: Readonly<{ actorId: string } & SupplierListQuery>,
  ) {
    return this.repository.listSuppliers(organizationId, input);
  }

  getSupplier(
    organizationId: string,
    input: Readonly<{ actorId: string; supplierId: string }>,
  ) {
    return this.repository.getSupplier(organizationId, input);
  }

  createSupplier(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateSupplierInput>,
  ) {
    return this.repository.createSupplier(organizationId, input);
  }

  updateSupplier(
    organizationId: string,
    input: Readonly<
      { actorId: string; supplierId: string } & UpdateSupplierInput
    >,
  ) {
    return this.repository.updateSupplier(organizationId, input);
  }

  archiveSupplier(
    organizationId: string,
    input: Readonly<
      { actorId: string; supplierId: string } & ArchiveSupplierInput
    >,
  ) {
    return this.repository.archiveSupplier(organizationId, input);
  }

  createContact(
    organizationId: string,
    input: Readonly<
      { actorId: string; supplierId: string } & CreateSupplierContactInput
    >,
  ) {
    return this.repository.createContact(organizationId, input);
  }

  updateContact(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        contactId: string;
      } & UpdateSupplierContactInput
    >,
  ) {
    return this.repository.updateContact(organizationId, input);
  }

  archiveContact(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        contactId: string;
      } & ArchiveSupplierContactInput
    >,
  ) {
    return this.repository.archiveContact(organizationId, input);
  }

  createResponsibility(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
      } & CreateSupplierResponsibilityInput
    >,
  ) {
    return this.repository.createResponsibility(organizationId, input);
  }

  endResponsibility(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        responsibilityId: string;
      } & EndSupplierResponsibilityInput
    >,
  ) {
    return this.repository.endResponsibility(organizationId, input);
  }

  associateRequest(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        supplierId: string;
        requestId: string;
      } & AssociateSupplierRequestInput
    >,
  ) {
    return this.repository.associateRequest(organizationId, input);
  }

  findingResponsibleSuppliers(
    organizationId: string,
    input: Readonly<{ actorId: string; findingId: string }>,
  ) {
    return this.repository.findingResponsibleSuppliers(organizationId, input);
  }
}
