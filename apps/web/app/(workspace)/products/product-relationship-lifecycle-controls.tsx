"use client";

import type {
  ProductComponentLink,
  ProductVariantRelationship,
  SoftwareBaselineReleaseMembership,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";

type RelationshipLifecycleControlsProps = Readonly<{
  memberships: readonly SoftwareBaselineReleaseMembership[];
  variants: readonly ProductVariantRelationship[];
  components: readonly ProductComponentLink[];
  selectedMembershipId: string;
  selectedVariantId: string;
  selectedComponentId: string;
  effectiveEndsAt: string;
  hasEndEvidence: boolean;
  hasUpdateEvidence: boolean;
  hasReevaluationEvidence: boolean;
  endMembershipPending: boolean;
  endVariantPending: boolean;
  endComponentPending: boolean;
  updateComponentPending: boolean;
  reevaluationPending: boolean;
  onSelectedMembershipChange: (value: string) => void;
  onSelectedVariantChange: (value: string) => void;
  onSelectedComponentChange: (value: string) => void;
  onEffectiveEndsAtChange: (value: string) => void;
  onEndMembership: () => void;
  onEndVariant: () => void;
  onEndComponent: () => void;
  onUpdateComponent: () => void;
  onRequestReevaluation: () => void;
}>;

export function ProductRelationshipLifecycleControls({
  memberships,
  variants,
  components,
  selectedMembershipId,
  selectedVariantId,
  selectedComponentId,
  effectiveEndsAt,
  hasEndEvidence,
  hasUpdateEvidence,
  hasReevaluationEvidence,
  endMembershipPending,
  endVariantPending,
  endComponentPending,
  updateComponentPending,
  reevaluationPending,
  onSelectedMembershipChange,
  onSelectedVariantChange,
  onSelectedComponentChange,
  onEffectiveEndsAtChange,
  onEndMembership,
  onEndVariant,
  onEndComponent,
  onUpdateComponent,
  onRequestReevaluation,
}: RelationshipLifecycleControlsProps) {
  const activeMemberships = memberships.filter(
    (membership) => membership.endedAt === null,
  );
  const activeVariants = variants.filter((variant) => variant.endedAt === null);
  const activeComponents = components.filter(
    (component) => component.endedAt === null,
  );

  return (
    <section
      aria-label="Relationship lifecycle controls"
      className="grid gap-4 rounded-xl border border-border bg-surface-subtle p-4"
    >
      <div className="grid gap-3">
        <h3 className="text-subhead-semibold text-fg">
          End or update a relationship
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          Ending and replacement commands preserve the prior relationship
          history.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Baseline membership
            <select
              aria-label="Baseline membership to end"
              value={selectedMembershipId}
              onChange={(event) =>
                onSelectedMembershipChange(event.target.value)
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="">Select active membership</option>
              {activeMemberships.map((membership) => (
                <option key={membership.id} value={membership.id}>
                  {membership.baselineId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Variant relationship
            <select
              aria-label="Variant relationship to end"
              value={selectedVariantId}
              onChange={(event) => onSelectedVariantChange(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="">Select active variant</option>
              {activeVariants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.targetReleaseId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Component link
            <select
              aria-label="Component link to change"
              value={selectedComponentId}
              onChange={(event) =>
                onSelectedComponentChange(event.target.value)
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="">Select active component</option>
              {activeComponents.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.componentProductId}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex max-w-md flex-col gap-2 text-caption-1-regular text-fg">
          Relationship effective end
          <input
            type="datetime-local"
            aria-label="Relationship effective end"
            required
            value={effectiveEndsAt}
            onChange={(event) => onEffectiveEndsAtChange(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={selectedMembershipId === "" || !hasEndEvidence}
            loading={endMembershipPending}
            loadingLabel="Ending baseline membership"
            onClick={onEndMembership}
          >
            End baseline membership
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={selectedVariantId === "" || !hasEndEvidence}
            loading={endVariantPending}
            loadingLabel="Ending variant relationship"
            onClick={onEndVariant}
          >
            End variant relationship
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={selectedComponentId === "" || !hasEndEvidence}
            loading={endComponentPending}
            loadingLabel="Ending component link"
            onClick={onEndComponent}
          >
            End component link
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={selectedComponentId === "" || !hasUpdateEvidence}
            loading={updateComponentPending}
            loadingLabel="Updating component link"
            onClick={onUpdateComponent}
          >
            Update component link
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          <h3 className="text-subhead-semibold text-fg">
            Re-evaluate relationships
          </h3>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Queue durable propagation for the current graph version.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          disabled={!hasReevaluationEvidence}
          loading={reevaluationPending}
          loadingLabel="Queueing re-evaluation"
          onClick={onRequestReevaluation}
        >
          Queue relationship re-evaluation
        </Button>
      </div>
    </section>
  );
}
