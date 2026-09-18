/**
 * Records authoritative, already-committed feature evidence for onboarding.
 *
 * Product, SBOM, and invitation workflows call this after their own durable
 * commit. This port deliberately has no generic "complete stage" operation,
 * so a browser route cannot mark onboarding complete without evidence.
 */
export abstract class OnboardingEvidenceRecorder {
  abstract recordProductCreated(
    orgId: string,
    productId: string,
    actorId: string,
  ): Promise<void>;

  abstract recordSbomCreated(
    orgId: string,
    sbomId: string,
    actorId: string,
  ): Promise<void>;

  abstract recordInvitationDelivery(
    orgId: string,
    invitationId: string,
    actorId: string,
  ): Promise<void>;
}
