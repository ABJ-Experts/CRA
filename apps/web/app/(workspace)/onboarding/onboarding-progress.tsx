import type {
  OnboardingResponse,
  OnboardingStageRecord,
} from "@repo/contracts";
import { cn } from "@repo/ui/cn";

const STAGE_LABELS = {
  organization_details: "Organization details",
  first_product: "First product",
  first_sbom: "First SBOM",
  invite_team: "Invite the team",
  completed: "Complete onboarding",
} as const;

function statusLabel(stage: OnboardingStageRecord): string {
  if (stage.status === "completed") return "Completed";
  if (stage.status === "blocked") return "Blocked";
  return "Not started";
}

function stageDetail(
  stage: OnboardingStageRecord,
  integrationAvailability: OnboardingResponse["integrationAvailability"],
) {
  if (stage.unavailableResourceIds.length > 0) {
    return "Historical evidence is unavailable; confirmed progress is retained.";
  }
  if (stage.stage === "first_product") {
    return integrationAvailability.products
      ? "Awaiting product evidence from the server."
      : "Integration unavailable";
  }
  if (stage.stage === "first_sbom") {
    return integrationAvailability.sbom
      ? "Awaiting SBOM evidence from the server."
      : "Integration unavailable";
  }
  if (stage.stage === "invite_team" && !integrationAvailability.invitations) {
    return "Invitation integration unavailable";
  }
  if (stage.blockReason === "awaiting_prior_stage") {
    return "Awaiting an earlier server-confirmed stage.";
  }
  if (stage.blockReason === "awaiting_authoritative_product") {
    return "Awaiting authoritative product evidence.";
  }
  if (stage.blockReason === "awaiting_authoritative_sbom") {
    return "Awaiting authoritative SBOM evidence.";
  }
  return stage.status === "completed"
    ? "Confirmed by the server."
    : "Waiting for server-confirmed progress.";
}

function StageRow({
  stage,
  integrationAvailability,
}: {
  stage: OnboardingStageRecord;
  integrationAvailability: OnboardingResponse["integrationAvailability"];
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between",
        stage.status === "completed" && "bg-positive-surface",
      )}
    >
      <div className="min-w-0">
        <h3 className="text-subhead-semibold text-fg">
          {STAGE_LABELS[stage.stage]}
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          {stageDetail(stage, integrationAvailability)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-caption-2-semibold",
            stage.status === "completed"
              ? "bg-positive-surface text-positive-fg"
              : stage.status === "blocked"
                ? "bg-warning-surface text-warning-fg"
                : "bg-surface-raised text-fg-muted",
          )}
        >
          {statusLabel(stage)}
        </span>
      </div>
    </li>
  );
}

export function OnboardingProgress({
  progress,
}: {
  progress: OnboardingResponse;
}) {
  if (progress.nextIncompleteStage === null) {
    return (
      <p role="status" className="text-subhead-regular text-positive-fg">
        Organization onboarding is complete.
      </p>
    );
  }

  return (
    <ol aria-label="Onboarding progress" className="flex flex-col gap-3">
      {progress.stages.map((stage) => (
        <StageRow
          key={stage.stage}
          stage={stage}
          integrationAvailability={progress.integrationAvailability}
        />
      ))}
    </ol>
  );
}
