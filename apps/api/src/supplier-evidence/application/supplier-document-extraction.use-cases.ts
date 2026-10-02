import type {
  CreateManualSupplierDocumentFieldInput,
  DecideSupplierDocumentFieldInput,
  StartSupplierDocumentExtractionInput,
  SupplierDocumentExtractionResponse,
  SupplierDocumentExtractionQuery,
  SupplierDocumentFieldResponse,
} from "@repo/contracts/supplier-evidence";

type ScopedSubmission = Readonly<{
  actorId: string;
  requestId: string;
  submissionId: string;
}>;

export interface SupplierDocumentExtractionRepository {
  start(
    organizationId: string,
    input: ScopedSubmission & StartSupplierDocumentExtractionInput,
  ): Promise<SupplierDocumentExtractionResponse>;
  read(
    organizationId: string,
    input: ScopedSubmission & SupplierDocumentExtractionQuery,
  ): Promise<SupplierDocumentExtractionResponse>;
  decide(
    organizationId: string,
    input: ScopedSubmission &
      Readonly<{ fieldId: string }> &
      DecideSupplierDocumentFieldInput,
  ): Promise<SupplierDocumentFieldResponse>;
  manual(
    organizationId: string,
    input: ScopedSubmission & CreateManualSupplierDocumentFieldInput,
  ): Promise<SupplierDocumentFieldResponse>;
}

export class SupplierDocumentExtractionUseCases {
  constructor(
    private readonly repository: SupplierDocumentExtractionRepository,
  ) {}

  start(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["start"]>[1],
  ) {
    return this.repository.start(organizationId, input);
  }

  read(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["read"]>[1],
  ) {
    return this.repository.read(organizationId, input);
  }

  decide(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["decide"]>[1],
  ) {
    return this.repository.decide(organizationId, input);
  }

  manual(
    organizationId: string,
    input: Parameters<SupplierDocumentExtractionRepository["manual"]>[1],
  ) {
    return this.repository.manual(organizationId, input);
  }
}
