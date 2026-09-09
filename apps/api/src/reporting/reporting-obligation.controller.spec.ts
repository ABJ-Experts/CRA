import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";

import type { RequestUser } from "../auth/auth.types";
import { ReportingObligationConflictError } from "./application/reporting-obligation.port";
import type { ReportingObligationUseCases } from "./application/reporting-obligation-use-cases";
import { ReportingObligationController } from "./reporting-obligation.controller";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const findingId = "44444444-4444-4444-8444-444444444444";
const key = "55555555-5555-4555-8555-555555555555";
const user = {
  id: actorId,
  organizationId,
  aal: "aal1",
} as unknown as RequestUser;

describe("ReportingObligationController", () => {
  it("scopes reporting reads and mutations to the verified organization", async () => {
    const useCases = useCasesFor();
    useCases.list.mockResolvedValue({ obligations: [], nextCursor: null });
    useCases.create.mockResolvedValue(mutationFixture());
    const controller = subject(useCases);

    await expect(controller.list({ limit: 50 }, user)).resolves.toEqual({
      obligations: [],
      nextCursor: null,
    });
    await expect(
      controller.create(
        {
          type: "actively_exploited_vulnerability",
          source: { kind: "finding", findingId },
          awarenessAt: "2026-04-14T09:20:00Z",
          awarenessBasis: "Customer security team asserted awareness.",
          idempotencyKey: key,
        },
        user,
      ),
    ).resolves.toMatchObject({ idempotent: false });

    expect(useCases.list).toHaveBeenCalledWith(organizationId, {
      actorId,
      limit: 50,
    });
    expect(useCases.create).toHaveBeenCalledWith(organizationId, {
      actorId,
      type: "actively_exploited_vulnerability",
      source: { kind: "finding", findingId },
      awarenessAt: "2026-04-14T09:20:00Z",
      awarenessBasis: "Customer security team asserted awareness.",
      idempotencyKey: key,
    });
  });

  it("maps tenant-hidden resources and optimistic conflicts safely", async () => {
    const useCases = useCasesFor();
    useCases.detail.mockResolvedValue(null);
    useCases.cancel.mockRejectedValue(new ReportingObligationConflictError());
    const controller = subject(useCases);

    await expect(
      controller.detail({ obligationId }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.cancel(
        { obligationId },
        {
          reason: "Duplicate obligation opened by mistake.",
          expectedVersion: 1,
          idempotencyKey: key,
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("scopes the compact deadline summary to the verified organization", async () => {
    const useCases = useCasesFor();
    useCases.deadlineSummary.mockResolvedValue({
      summary: {
        serverNow: "2026-09-09T10:00:00Z",
        overdueCount: 1,
        nextDeadline: {
          obligationId,
          stage: "early_warning",
          dueAt: "2026-09-10T10:00:00Z",
          elapsedPercent: 50,
          reportingHref: `/reporting?obligationId=${obligationId}`,
        },
      },
    });
    const controller = subject(useCases);

    await expect(controller.deadlineSummary({}, user)).resolves.toEqual({
      summary: {
        serverNow: "2026-09-09T10:00:00Z",
        overdueCount: 1,
        nextDeadline: {
          obligationId,
          stage: "early_warning",
          dueAt: "2026-09-10T10:00:00Z",
          elapsedPercent: 50,
          reportingHref: `/reporting?obligationId=${obligationId}`,
        },
      },
    });
    expect(useCases.deadlineSummary).toHaveBeenCalledWith(organizationId, {
      actorId,
    });
  });
});

function subject(useCases: ReturnType<typeof useCasesFor>) {
  return new ReportingObligationController(
    useCases as unknown as ReportingObligationUseCases,
  );
}

function useCasesFor() {
  return {
    deadlineSummary: jest.fn(),
    list: jest.fn(),
    detail: jest.fn(),
    create: jest.fn(),
    correctAnchor: jest.fn(),
    recordSubmission: jest.fn(),
    cancel: jest.fn(),
  };
}

function mutationFixture() {
  return {
    obligation: obligationFixture(),
    idempotent: false,
  };
}

function obligationFixture() {
  return {
    id: obligationId,
    organizationId,
    type: "actively_exploited_vulnerability",
    status: "active",
    source: { kind: "finding", findingId },
    ruleSet: {
      id: "66666666-6666-4666-8666-666666666666",
      version: 1,
      jurisdiction: "EU-CRA",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: null,
    },
    awarenessAt: "2026-04-14T09:20:00Z",
    awarenessBasis: "Customer security team asserted awareness.",
    createdBy: { userId: actorId, displayName: "Owner Account" },
    createdAt: "2026-09-09T09:20:00Z",
    updatedAt: "2026-09-09T09:20:00Z",
    version: 1,
    cancelledAt: null,
    cancellationReason: null,
    stages: [
      stage("early_warning", "awareness", "PT24H", "2026-04-15T09:20:00Z"),
      stage("notification", "awareness", "PT72H", "2026-04-17T09:20:00Z"),
      stage("final_report", "remediation_available", "P14D", null),
    ],
    anchors: [
      {
        kind: "awareness",
        anchoredAt: "2026-04-14T09:20:00Z",
        basis: "Customer security team asserted awareness.",
        reason: null,
        recordedBy: { userId: actorId, displayName: "Owner Account" },
        recordedAt: "2026-09-09T09:20:00Z",
      },
    ],
  };
}

function stage(
  kind: "early_warning" | "notification" | "final_report",
  anchor: "awareness" | "remediation_available",
  duration: "PT24H" | "PT72H" | "P14D",
  dueAt: string | null,
) {
  return {
    id: randomUUID(),
    kind,
    anchor,
    duration,
    state: dueAt === null ? "pending_anchor" : "running",
    dueAt,
    submittedAt: null,
    overdueAt: null,
    version: 1,
  };
}
