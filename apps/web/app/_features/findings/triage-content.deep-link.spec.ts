import { describe, expect, it } from "vitest";

import { readFindingAssessmentDeepLink } from "./triage-content";

const findingId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "22222222-2222-4222-8222-222222222222";

describe("finding assessment deep link", () => {
  it("accepts one source finding and matching assessment identity", () => {
    expect(
      readFindingAssessmentDeepLink(
        new URLSearchParams({ findingId, assessmentId }),
      ),
    ).toEqual({ findingId, assessmentId, invalidAssessmentLink: false });
  });

  it("treats malformed and duplicate assessment IDs as invalid task links", () => {
    expect(
      readFindingAssessmentDeepLink(
        new URLSearchParams({ findingId, assessmentId: "invalid" }),
      ),
    ).toEqual({ findingId, assessmentId: null, invalidAssessmentLink: true });
    expect(
      readFindingAssessmentDeepLink(
        new URLSearchParams(
          `findingId=${findingId}&assessmentId=${assessmentId}&assessmentId=${assessmentId}`,
        ),
      ),
    ).toEqual({ findingId, assessmentId: null, invalidAssessmentLink: true });
  });

  it("preserves finding-only links and refuses ambiguous finding IDs", () => {
    expect(
      readFindingAssessmentDeepLink(new URLSearchParams({ findingId })),
    ).toEqual({ findingId, assessmentId: null, invalidAssessmentLink: false });
    expect(
      readFindingAssessmentDeepLink(
        new URLSearchParams(`findingId=${findingId}&findingId=${findingId}`),
      ),
    ).toEqual({
      findingId: null,
      assessmentId: null,
      invalidAssessmentLink: false,
    });
  });
});
