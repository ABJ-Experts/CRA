export const EVIDENCE_REUSE_VALIDITY_REPOSITORY = Symbol(
  "EVIDENCE_REUSE_VALIDITY_REPOSITORY",
);

type ReuseInput = Readonly<{
  actorId: string;
  productId: string;
  documentId: string;
  versionId: string;
}>;
type IntervalInput = Readonly<{
  actorId: string;
  input: UpdateEvidenceExpiryAlertIntervalsInput;
}>;

/** Focused application boundary for validity configuration and safe reverse links. */
export interface EvidenceReuseValidityRepository {
  reuse(
    organizationId: string,
    input: ReuseInput,
  ): Promise<EvidenceVersionReuseResponse | null>;
  expiryAlertIntervals(
    organizationId: string,
    input: Pick<ReuseInput, "actorId">,
  ): Promise<EvidenceExpiryAlertIntervalsResponse | null>;
  updateExpiryAlertIntervals(
    organizationId: string,
    input: IntervalInput,
  ): Promise<
    | Readonly<{
        outcome: "updated";
        value: EvidenceExpiryAlertIntervalsResponse;
      }>
    | Readonly<{ outcome: "conflict" | "forbidden" | "not_found" }>
  >;
}

export class EvidenceReuseValidityUseCases {
  constructor(private readonly repository: EvidenceReuseValidityRepository) {}

  reuse(
    input: ReuseInput & Readonly<{ organizationId: string }>,
  ): Promise<EvidenceVersionReuseResponse | null> {
    const { organizationId, ...request } = input;
    return this.repository.reuse(organizationId, request);
  }

  expiryAlertIntervals(
    input: Pick<ReuseInput, "actorId"> & Readonly<{ organizationId: string }>,
  ): Promise<EvidenceExpiryAlertIntervalsResponse | null> {
    const { organizationId, ...request } = input;
    return this.repository.expiryAlertIntervals(organizationId, request);
  }

  updateExpiryAlertIntervals(
    input: IntervalInput & Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.updateExpiryAlertIntervals(organizationId, request);
  }
}
import type {
  EvidenceExpiryAlertIntervalsResponse,
  EvidenceVersionReuseResponse,
  UpdateEvidenceExpiryAlertIntervalsInput,
} from "@repo/contracts/evidence";
