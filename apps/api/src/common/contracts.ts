// The named OpenAPI components, registered once at import time.
//
// Controllers reference these keys rather than string literals, so a typo is a
// compile error instead of a dangling $ref that only surfaces when the client
// generator produces `unknown`.

import {
  createdResourceResponse,
  dashboardResponse,
  evidenceResponse,
  falsePositiveRateResponse,
  findingPageResponse,
  findingResponse,
  membershipListResponse,
  principalResponse,
  obligationResponse,
  obligationStageResponse,
  obligationTickResponse,
  organisationResponse,
  problemDetails,
  productResponse,
  releaseResponse,
  sbomIngestResponse,
  healthResponse,
} from '@repo/schemas';
import { registerComponent } from './api-contract.decorator';

export const C = {
  Organisation: registerComponent('Organisation', organisationResponse),
  MembershipList: registerComponent('MembershipList', membershipListResponse),
  Principal: registerComponent('Principal', principalResponse),
  CreatedResource: registerComponent(
    'CreatedResource',
    createdResourceResponse,
  ),
  Product: registerComponent('Product', productResponse),
  Release: registerComponent('Release', releaseResponse),
  SbomIngest: registerComponent('SbomIngest', sbomIngestResponse),
  Finding: registerComponent('Finding', findingResponse),
  FindingPage: registerComponent('FindingPage', findingPageResponse),
  FalsePositiveRate: registerComponent(
    'FalsePositiveRate',
    falsePositiveRateResponse,
  ),
  Obligation: registerComponent('Obligation', obligationResponse),
  ObligationStage: registerComponent(
    'ObligationStage',
    obligationStageResponse,
  ),
  ObligationTick: registerComponent('ObligationTick', obligationTickResponse),
  Evidence: registerComponent('Evidence', evidenceResponse),
  Dashboard: registerComponent('Dashboard', dashboardResponse),
  Health: registerComponent('Health', healthResponse),
  // Every endpoint can return this (§13.1). Registered so the generated client
  // can narrow an error branch rather than treating failures as untyped.
  ProblemDetails: registerComponent('ProblemDetails', problemDetails),
} as const;
