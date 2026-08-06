import "server-only";
import { readSession } from "../../../lib/session";

/**
 * Server-side reads for the product screens.
 *
 * Server components call apps/api directly rather than looping back through
 * /api/cras — the proxy exists so the BROWSER can reach the API without ever
 * holding the token, and a server component already has the cookie. Going via
 * the proxy would add a pointless second HTTP hop to our own origin.
 */

const base = () => process.env.API_URL ?? "http://127.0.0.1:3333";

export interface ApiResult<T> {
  data?: T;
  /** RFC 9457 `detail`, with the correlationId appended when present. */
  error?: string;
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const session = await readSession();
  if (!session?.organisationId) return { error: "No active organisation." };

  const res = await fetch(`${base()}${path}`, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-organisation-id": session.organisationId,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    /* Surface `detail` and `correlationId` rather than a bare status: the API
     * goes to the trouble of emitting both so a support conversation can find
     * the matching server log line. */
    const problem = (await res.json().catch(() => null)) as {
      detail?: string;
      correlationId?: string;
    } | null;
    const ref = problem?.correlationId ? ` (ref ${problem.correlationId})` : "";
    return { error: `${problem?.detail ?? res.statusText}${ref}` };
  }

  return { data: (await res.json()) as T };
}

export interface DashboardData {
  findingsBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
  kevOpenCount: number;
  activeObligations: unknown[];
  sbomCoverage: { products: number; releases: number; releasesWithSbom: number };
  ingestionHealth: {
    valid: number;
    validWithWarnings: number;
    invalid: number;
    lastIngestAt: string | null;
  };
  generatedAt: string;
}

export interface ProductRow {
  id: string;
  name: string;
  internalCode: string;
  productType: string;
  lifecycleState: string;
  placedOnMarketAt: string | null;
  version: number;
}

export interface ReleaseRow {
  id: string;
  productId: string;
  versionLabel: string;
  lifecycleState: string;
  sbomCount: number;
  createdAt: string;
}

export interface PrincipalData {
  organisationId: string;
  roleKey: string;
  permissions: string[];
  mfaSatisfied: boolean;
}

export interface OrganisationData {
  id: string;
  legalName: string;
  countryMainEstablishment: string;
  coordinatingCsirt: string | null;
  onboardingState: { step?: string; productId?: string; productReleaseId?: string };
}

export interface FindingRow {
  id: string;
  advisoryId: string;
  matchMethod: string;
  matchConfidence: number;
  cvssBase: number | null;
  kevListed: boolean;
  vexStatus: string;
  vexJustification: string | null;
  state: string;
  lowConfidence: boolean;
  falsePositiveReason: string | null;
  version: number;
}

export interface FindingPageData {
  items: FindingRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ObligationRow {
  id: string;
  obligationType: string;
  state: string;
  awarenessAt: string;
  findingId: string | null;
  productReleaseId: string | null;
  nextStage: string | null;
  nextDueAt: string | null;
  overdue: boolean;
  createdAt: string;
}

export interface ObligationStageRow {
  stage: string;
  anchorEvent: string;
  dueAt: string | null;
  state: string;
}
