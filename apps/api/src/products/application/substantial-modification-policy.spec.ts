import {
  SUBSTANTIAL_MODIFICATION_POLICY_VERSION,
  suggestSubstantialModification,
} from "./substantial-modification-policy";

const noAnswers = {
  changesIntendedPurpose: "no",
  changesSecurityArchitectureOrTrustBoundary: "no",
  changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
  changesCryptographyOrIdentityAccessControl: "no",
  changesSafetyOrSecurityRelevantComponent: "no",
} as const;

describe("substantial modification policy", () => {
  it("labels a yes answer as potentially substantial without making a legal conclusion", () => {
    expect(
      suggestSubstantialModification({
        ...noAnswers,
        changesCryptographyOrIdentityAccessControl: "yes",
      }),
    ).toEqual({
      policyVersion: SUBSTANTIAL_MODIFICATION_POLICY_VERSION,
      suggestion: "potentially_substantial",
      authoritative: false,
    });
  });

  it("is undetermined when no answer is yes but one is unknown", () => {
    expect(
      suggestSubstantialModification({
        ...noAnswers,
        changesIntendedPurpose: "unknown",
      }).suggestion,
    ).toBe("undetermined");
  });

  it("suggests not substantial only when every answer is no", () => {
    expect(suggestSubstantialModification(noAnswers).suggestion).toBe(
      "not_substantial",
    );
  });
});
