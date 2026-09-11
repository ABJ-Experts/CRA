export const SUBSTANTIAL_MODIFICATION_POLICY_VERSION =
  "m2.v2.substantial-modification.v1" as const;

export type SubstantialModificationAnswer = "yes" | "no" | "unknown";
export type SubstantialModificationAnswers = Readonly<{
  changesIntendedPurpose: SubstantialModificationAnswer;
  changesSecurityArchitectureOrTrustBoundary: SubstantialModificationAnswer;
  changesNetworkInterfaceOrPrivilegedRemoteControl: SubstantialModificationAnswer;
  changesCryptographyOrIdentityAccessControl: SubstantialModificationAnswer;
  changesSafetyOrSecurityRelevantComponent: SubstantialModificationAnswer;
}>;
export type SubstantialModificationSuggestion =
  "potentially_substantial" | "undetermined" | "not_substantial";

/**
 * This is a decision-support signal only. A human reviewer records every
 * authoritative determination outside this pure policy.
 */
export function suggestSubstantialModification(
  answers: SubstantialModificationAnswers,
): Readonly<{
  policyVersion: typeof SUBSTANTIAL_MODIFICATION_POLICY_VERSION;
  suggestion: SubstantialModificationSuggestion;
  authoritative: false;
}> {
  const values = Object.values(answers);
  const suggestion = values.includes("yes")
    ? "potentially_substantial"
    : values.includes("unknown")
      ? "undetermined"
      : "not_substantial";
  return Object.freeze({
    policyVersion: SUBSTANTIAL_MODIFICATION_POLICY_VERSION,
    suggestion,
    authoritative: false,
  });
}
