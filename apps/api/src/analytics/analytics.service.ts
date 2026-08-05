// FR-AN-001 dashboard aggregates. Every query runs through withTenant, so counts
// are RLS-scoped and can never include another org's rows (FR-AN-009: aggregates
// must not leak the existence of unreadable records). Deterministic, no AI.
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  finding,
  obligationStage,
  product,
  productRelease,
  reportingObligation,
  sbomDocument,
  withTenant,
} from '../db';

// A finding is "active" until it is closed or suppressed (§8.4).
const ACTIVE_FINDING_STATES = [
  'open',
  'in_triage',
  'awaiting_approval',
  'reopened',
] as const;

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface DashboardView {
  findingsBySeverity: SeverityCounts;
  kevOpenCount: number;
  activeObligations: {
    obligationId: string;
    obligationType: string;
    nextDueAt: string | null; // ISO UTC; soonest running stage
    nextStage: string | null;
    overdue: boolean;
  }[];
  sbomCoverage: {
    products: number;
    releases: number;
    releasesWithSbom: number;
  };
  ingestionHealth: {
    valid: number;
    validWithWarnings: number;
    invalid: number;
    lastIngestAt: string | null;
  };
  generatedAt: string;
}

// CVSS base → severity bucket (BRD §9.2 severity bands).
function severityOf(cvss: number | null): keyof SeverityCounts {
  if (cvss === null) return 'unknown';
  if (cvss >= 9) return 'critical';
  if (cvss >= 7) return 'high';
  if (cvss >= 4) return 'medium';
  return 'low';
}

export async function getDashboard(
  organisationId: string,
): Promise<DashboardView> {
  return withTenant({ organisationId }, async (tx) => {
    const activeFindings = await tx
      .select({ cvssBase: finding.cvssBase, kevListed: finding.kevListed })
      .from(finding)
      .where(inArray(finding.state, [...ACTIVE_FINDING_STATES]));

    const findingsBySeverity: SeverityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };
    let kevOpenCount = 0;
    for (const f of activeFindings) {
      findingsBySeverity[severityOf(f.cvssBase)] += 1;
      if (f.kevListed) kevOpenCount += 1;
    }

    // Active obligations with the soonest running-stage deadline (live countdown).
    const obligations = await tx
      .select()
      .from(reportingObligation)
      .where(eq(reportingObligation.state, 'active'));
    const activeObligations = [];
    for (const ob of obligations) {
      const [next] = await tx
        .select({
          stage: obligationStage.stage,
          dueAt: obligationStage.dueAt,
          state: obligationStage.state,
        })
        .from(obligationStage)
        .where(
          and(
            eq(obligationStage.obligationId, ob.id),
            inArray(obligationStage.state, ['running', 'overdue']),
            isNotNull(obligationStage.dueAt),
          ),
        )
        .orderBy(obligationStage.dueAt)
        .limit(1);
      activeObligations.push({
        obligationId: ob.id,
        obligationType: ob.obligationType,
        nextDueAt: next?.dueAt ? next.dueAt.toISOString() : null,
        nextStage: next?.stage ?? null,
        overdue: next?.state === 'overdue',
      });
    }

    const products = await tx
      .select({ id: product.id })
      .from(product)
      .where(eq(product.organisationId, organisationId));
    const releases = await tx
      .select({ id: productRelease.id })
      .from(productRelease);
    const documents = await tx
      .select({
        releaseId: sbomDocument.productReleaseId,
        status: sbomDocument.validationStatus,
        createdAt: sbomDocument.createdAt,
      })
      .from(sbomDocument)
      .orderBy(desc(sbomDocument.createdAt));

    const releasesWithSbom = new Set(documents.map((d) => d.releaseId)).size;
    const ingestionHealth = {
      valid: documents.filter((d) => d.status === 'valid').length,
      validWithWarnings: documents.filter(
        (d) => d.status === 'valid_with_warnings',
      ).length,
      invalid: documents.filter((d) => d.status === 'invalid').length,
      lastIngestAt: documents[0]?.createdAt
        ? documents[0].createdAt.toISOString()
        : null,
    };

    return {
      findingsBySeverity,
      kevOpenCount,
      activeObligations,
      sbomCoverage: {
        products: products.length,
        releases: releases.length,
        releasesWithSbom,
      },
      ingestionHealth,
      generatedAt: new Date().toISOString(),
    };
  });
}
