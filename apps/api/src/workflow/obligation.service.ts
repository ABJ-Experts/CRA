import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  finding,
  obligationStage,
  obligationTimelineEvent,
  reportingObligation,
  withTenant,
} from '../db';
import { recordAuditInTx } from '../audit';
import { DomainError } from '../product';
import { computeDueAt } from './obligation-clock';
import { evaluateStage } from './obligation-tick';

export type ObligationType =
  'actively_exploited_vulnerability' | 'severe_incident';
export type AnchorEvent =
  'awareness' | 'notification_submitted' | 'remediation_available';

// The obligation rule set (would be OBLIGATION_RULESET_PATH config with effective
// dates; inline for MVP). An obligation stores the version it was created under.
const RULE_SET_VERSION = 'EU-CRA-2026-09-11';

interface StageRule {
  stage: 'early_warning' | 'notification' | 'final_report';
  anchor: AnchorEvent;
  duration: string; // ISO 8601
}

const RULES: Record<ObligationType, readonly StageRule[]> = {
  actively_exploited_vulnerability: [
    { stage: 'early_warning', anchor: 'awareness', duration: 'PT24H' },
    { stage: 'notification', anchor: 'awareness', duration: 'PT72H' },
    {
      stage: 'final_report',
      anchor: 'remediation_available',
      duration: 'P14D',
    },
  ],
  severe_incident: [
    { stage: 'early_warning', anchor: 'awareness', duration: 'PT24H' },
    { stage: 'notification', anchor: 'awareness', duration: 'PT72H' },
    {
      stage: 'final_report',
      anchor: 'notification_submitted',
      duration: 'P1M',
    },
  ],
};

export interface OpenObligationInput {
  obligationType: ObligationType;
  awarenessAt: Date;
  awarenessBasis?: string;
  findingId?: string;
  productReleaseId?: string;
  affectedMemberStates?: string[];
}

export async function openObligation(
  organisationId: string,
  userAccountId: string,
  input: OpenObligationInput,
): Promise<{ id: string }> {
  const obligationId = uuidv7();
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    await tx.insert(reportingObligation).values({
      id: obligationId,
      organisationId,
      obligationType: input.obligationType,
      awarenessAt: input.awarenessAt,
      awarenessBasis: input.awarenessBasis ?? null,
      findingId: input.findingId ?? null,
      productReleaseId: input.productReleaseId ?? null,
      affectedMemberStates: input.affectedMemberStates ?? [],
      ruleSetVersion: RULE_SET_VERSION,
      state: 'active',
      createdBy: userAccountId,
      updatedBy: userAccountId,
    });
    for (const rule of RULES[input.obligationType]) {
      // Only awareness is known at creation; other stages wait (pending_anchor).
      const dueAt =
        rule.anchor === 'awareness'
          ? computeDueAt(input.awarenessAt, rule.duration)
          : null;
      await tx.insert(obligationStage).values({
        id: uuidv7(),
        organisationId,
        obligationId,
        stage: rule.stage,
        anchorEvent: rule.anchor,
        durationInterval: rule.duration,
        dueAt,
        state: dueAt ? 'running' : 'pending_anchor',
      });
    }
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'obligation.opened',
      resourceType: 'reporting_obligation',
      resourceId: obligationId,
      afterState: {
        obligationType: input.obligationType,
        awarenessAt: input.awarenessAt.toISOString(),
      },
    });
    return { id: obligationId };
  });
}

/** FR-VULN-011: open an actively-exploited-vulnerability obligation from a KEV finding. */
export async function openObligationFromFinding(
  organisationId: string,
  userAccountId: string,
  findingId: string,
  awarenessAt: Date,
): Promise<{ id: string }> {
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(finding)
      .where(eq(finding.id, findingId))
      .limit(1);
    if (!row) throw new DomainError('not_found', 'Finding not found');
    if (!row.kevListed) {
      throw new DomainError(
        'validation',
        'Obligation can only be opened from a KEV-listed finding',
      );
    }
    return openObligation(organisationId, userAccountId, {
      obligationType: 'actively_exploited_vulnerability',
      awarenessAt,
      findingId,
      productReleaseId: row.productReleaseId,
    });
  });
}

export interface ObligationView {
  id: string;
  obligationType: string;
  state: string;
  awarenessAt: string;
  findingId: string | null;
  productReleaseId: string | null;
  createdAt: string;
}

export async function listObligations(
  organisationId: string,
): Promise<ObligationView[]> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(reportingObligation)
      .orderBy(desc(reportingObligation.createdAt));
    return rows.map((r) => ({
      id: r.id,
      obligationType: r.obligationType,
      state: r.state,
      awarenessAt: r.awarenessAt.toISOString(),
      findingId: r.findingId,
      productReleaseId: r.productReleaseId,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

export interface StageView {
  stage: string;
  anchorEvent: string;
  dueAt: Date | null;
  state: string;
}

export async function listStages(
  organisationId: string,
  obligationId: string,
): Promise<StageView[]> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(obligationStage)
      .where(eq(obligationStage.obligationId, obligationId));
    return rows.map((r) => ({
      stage: r.stage,
      anchorEvent: r.anchorEvent,
      dueAt: r.dueAt,
      state: r.state,
    }));
  });
}

/**
 * Record an anchor event (remediation_available / notification_submitted) and
 * recompute the dependent stages' due_at IN THE SAME TRANSACTION (§11.1, FR-RPT-006).
 * due_at is recomputed from the rule set, never hand-set.
 */
export async function recordAnchor(
  organisationId: string,
  userAccountId: string,
  obligationId: string,
  anchor: 'remediation_available' | 'notification_submitted',
  at: Date,
): Promise<void> {
  await withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [ob] = await tx
      .select()
      .from(reportingObligation)
      .where(eq(reportingObligation.id, obligationId))
      .limit(1);
    if (!ob) throw new DomainError('not_found', 'Obligation not found');

    await tx
      .update(reportingObligation)
      .set(
        anchor === 'remediation_available'
          ? {
              remediationAvailableAt: at,
              updatedBy: userAccountId,
              updatedAt: new Date(),
            }
          : {
              notificationSubmittedAt: at,
              updatedBy: userAccountId,
              updatedAt: new Date(),
            },
      )
      .where(eq(reportingObligation.id, obligationId));

    const rules = RULES[ob.obligationType as ObligationType];
    const stages = await tx
      .select()
      .from(obligationStage)
      .where(
        and(
          eq(obligationStage.obligationId, obligationId),
          eq(obligationStage.anchorEvent, anchor),
        ),
      );
    for (const s of stages) {
      const rule = rules.find((r) => r.stage === s.stage);
      if (!rule) continue;
      const dueAt = computeDueAt(at, rule.duration);
      await tx
        .update(obligationStage)
        .set({ dueAt, state: 'running', updatedAt: new Date() })
        .where(eq(obligationStage.id, s.id));
    }

    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'obligation.anchor_recorded',
      resourceType: 'reporting_obligation',
      resourceId: obligationId,
      afterState: { anchor, at: at.toISOString() },
    });
  });
}

export interface ObligationNotification {
  obligationId: string;
  findingId: string | null;
  stage: string;
  kind: 'threshold' | 'overdue';
  threshold: number;
  dueAt: Date;
}

export interface TickResult {
  stagesEvaluated: number;
  notifications: ObligationNotification[];
}

// The anchor timestamp for a stage is the obligation column its anchor names.
function anchorTimestamp(
  anchor: string,
  o: {
    awarenessAt: Date;
    remediationAvailableAt: Date | null;
    notificationSubmittedAt: Date | null;
  },
): Date | null {
  if (anchor === 'awareness') return o.awarenessAt;
  if (anchor === 'remediation_available') return o.remediationAvailableAt;
  if (anchor === 'notification_submitted') return o.notificationSubmittedAt;
  return null;
}

/**
 * FR-SLA-005/006: reconcile every running stage against the clock. Marks passed
 * deadlines `overdue` (permanent + audited) and returns the escalation
 * notifications newly crossed this tick. Idempotent — thresholds already recorded
 * in notified_thresholds are skipped, so a duplicate/late tick sends nothing
 * (§11.4, ADR-006 "the DB is the source of truth"). Tenant-scoped: a global 1/min
 * scheduler fans this out per organisation. TODO(V1): FR-SLA-007 cross-org worker.
 */
export async function tickObligations(
  organisationId: string,
  now: Date,
): Promise<TickResult> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .select({
        stageId: obligationStage.id,
        obligationId: obligationStage.obligationId,
        stage: obligationStage.stage,
        anchorEvent: obligationStage.anchorEvent,
        dueAt: obligationStage.dueAt,
        state: obligationStage.state,
        notified: obligationStage.notifiedThresholds,
        findingId: reportingObligation.findingId,
        awarenessAt: reportingObligation.awarenessAt,
        remediationAvailableAt: reportingObligation.remediationAvailableAt,
        notificationSubmittedAt: reportingObligation.notificationSubmittedAt,
      })
      .from(obligationStage)
      .innerJoin(
        reportingObligation,
        eq(reportingObligation.id, obligationStage.obligationId),
      )
      .where(eq(obligationStage.state, 'running'));

    const notifications: ObligationNotification[] = [];
    for (const r of rows) {
      if (!r.dueAt) continue;
      const anchoredAt = anchorTimestamp(r.anchorEvent, r);
      if (!anchoredAt) continue;
      const { newlyCrossed, overdue } = evaluateStage(
        anchoredAt,
        r.dueAt,
        now,
        r.notified,
      );
      if (newlyCrossed.length === 0) continue;

      await tx
        .update(obligationStage)
        .set({
          notifiedThresholds: [...r.notified, ...newlyCrossed],
          // Overdue is terminal for the tick and always audited below.
          state: overdue ? 'overdue' : r.state,
          updatedAt: now,
        })
        .where(eq(obligationStage.id, r.stageId));

      for (const threshold of newlyCrossed) {
        const kind = threshold >= 1 ? 'overdue' : 'threshold';
        await tx.insert(obligationTimelineEvent).values({
          id: uuidv7(),
          organisationId,
          obligationId: r.obligationId,
          eventType:
            kind === 'overdue' ? 'stage.overdue' : 'stage.threshold_crossed',
          detail: { stage: r.stage, threshold, dueAt: r.dueAt.toISOString() },
          occurredAt: now,
        });
        notifications.push({
          obligationId: r.obligationId,
          findingId: r.findingId,
          stage: r.stage,
          kind,
          threshold,
          dueAt: r.dueAt,
        });
      }

      if (overdue) {
        // FR-SLA-006: a missed deadline is a state change — audit it (actor: system).
        await recordAuditInTx(tx, organisationId, {
          actorType: 'system',
          actorId: null,
          action: 'obligation.stage_overdue',
          resourceType: 'obligation_stage',
          resourceId: r.stageId,
          beforeState: { state: 'running' },
          afterState: { state: 'overdue', dueAt: r.dueAt.toISOString() },
        });
      }
    }
    return { stagesEvaluated: rows.length, notifications };
  });
}
