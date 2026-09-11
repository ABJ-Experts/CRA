"use client";

import {
  productFieldAuthorityFieldSchema,
  releaseFieldAuthorityFieldSchema,
} from "../../_features/connectors/connectors.schemas";
import type {
  FieldAuthorityImpactPreview,
  FieldAuthorityPolicy,
  FieldAuthorityPolicyValue,
  MappingEntityType,
} from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";

import {
  usePreviewMappingMutation,
  useSaveMappingMutation,
} from "../../_features/connectors/connectors.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This mapping changed in another session. Preview it again before saving.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the connector registry.";
  return fallback;
}

const POLICY_VALUE_OPTIONS: readonly {
  readonly value: FieldAuthorityPolicyValue;
  readonly label: string;
}[] = [
  { value: "cra_authoritative", label: "CRA authoritative" },
  { value: "external_authoritative", label: "External authoritative" },
  { value: "newest_with_review", label: "Newest, with review" },
  { value: "manual_only", label: "Manual only" },
];

const FIELD_NAME_OPTIONS: Readonly<
  Record<MappingEntityType, readonly string[]>
> = {
  product: productFieldAuthorityFieldSchema.options,
  release: releaseFieldAuthorityFieldSchema.options,
};

type MappingDraft = Readonly<{
  entityType: MappingEntityType;
  fieldName: string;
  policyValue: FieldAuthorityPolicyValue;
  protected: boolean;
  protectedReason: string;
}>;

function policyValueLabel(value: FieldAuthorityPolicyValue): string {
  return (
    POLICY_VALUE_OPTIONS.find((option) => option.value === value)?.label ??
    value
  );
}

function draftMatchesPreview(
  draft: MappingDraft,
  previewedFor: MappingDraft | null,
): boolean {
  if (!previewedFor) return false;
  return (
    draft.entityType === previewedFor.entityType &&
    draft.fieldName === previewedFor.fieldName &&
    draft.policyValue === previewedFor.policyValue &&
    draft.protected === previewedFor.protected &&
    draft.protectedReason === previewedFor.protectedReason
  );
}

function PreviewSummary({ preview }: { preview: FieldAuthorityImpactPreview }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-caption-1-regular text-fg sm:grid-cols-4">
      {(
        [
          ["wouldCreate", "create"],
          ["wouldUpdate", "update"],
          ["wouldBeIgnored", "ignored"],
          ["wouldConflict", "conflict"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="flex items-baseline gap-1">
          <dd className="font-medium tabular-nums">{preview[key]}</dd>
          <dt className="text-fg-muted">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Deliverable 3: field mapping and per-field authority policy. */
export function ConnectorMappingSection({
  connectorId,
  policies,
  canEdit,
  isOwner,
}: {
  connectorId: string;
  policies: readonly FieldAuthorityPolicy[];
  canEdit: boolean;
  isOwner: boolean;
}) {
  const preview = usePreviewMappingMutation(connectorId);
  const save = useSaveMappingMutation(connectorId);
  const [entityType, setEntityType] = useState<MappingEntityType>("product");
  const [fieldName, setFieldName] = useState<string>(
    FIELD_NAME_OPTIONS.product[0] ?? "",
  );
  const [policyValue, setPolicyValue] =
    useState<FieldAuthorityPolicyValue>("cra_authoritative");
  const [isProtected, setIsProtected] = useState(false);
  const [protectedReason, setProtectedReason] = useState("");
  const [previewed, setPreviewed] = useState<Readonly<{
    draft: MappingDraft;
    preview: FieldAuthorityImpactPreview;
  }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const draft: MappingDraft = {
    entityType,
    fieldName,
    policyValue,
    protected: isProtected,
    protectedReason,
  };
  const existingPolicy = policies.find(
    (policy) =>
      policy.entityType === entityType && policy.fieldName === fieldName,
  );
  const requiresOwner =
    existingPolicy?.protected === true &&
    (policyValue === "external_authoritative" || !isProtected);
  const previewFresh = draftMatchesPreview(draft, previewed?.draft ?? null);
  const canSave = canEdit && previewFresh && (!requiresOwner || isOwner);

  async function runPreview() {
    setMessage(null);
    if (!fieldName.trim()) {
      setMessage("Enter a field name before previewing.");
      return;
    }
    try {
      const response = await preview.mutateAsync({
        entityType,
        fieldName,
        policyValue,
        protected: isProtected,
        protectedReason: isProtected ? protectedReason || undefined : undefined,
      });
      setPreviewed({ draft, preview: response.preview });
    } catch (error) {
      setPreviewed(null);
      setMessage(errorMessage(error, "The mapping preview failed."));
    }
  }

  async function saveMapping() {
    setMessage(null);
    if (!previewed || !previewFresh) return;
    try {
      await save.mutateAsync({
        entityType,
        fieldName,
        policyValue,
        protected: isProtected,
        protectedReason: isProtected ? protectedReason || undefined : undefined,
        previewDigest: previewed.preview.previewDigest,
      });
      setMessage("Field authority policy saved.");
      setPreviewed(null);
    } catch (error) {
      setMessage(errorMessage(error, "The mapping could not be saved."));
    }
  }

  return (
    <SectionCard title="Mapping & authority policy">
      <div className="flex flex-col gap-6">
        {policies.length === 0 ? (
          <p className="text-subhead-regular text-fg-muted">
            No field authority policies have been configured.
          </p>
        ) : (
          <ul className="grid gap-2" aria-label="Field authority policies">
            {policies.map((policy) => (
              <li
                key={policy.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-subtle px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-subhead-semibold text-fg">
                    {policy.entityType}.{policy.fieldName}
                  </p>
                  <p className="text-caption-1-regular text-fg-muted">
                    {policyValueLabel(policy.policyValue)}
                  </p>
                </div>
                {policy.protected ? (
                  <Tag variant="fill" tone="orange" size="sm">
                    Protected
                  </Tag>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <label
              className="flex flex-col gap-2 text-caption-1-regular text-fg"
              htmlFor="mapping-entity-type"
            >
              Entity type
              <select
                id="mapping-entity-type"
                value={entityType}
                onChange={(event) => {
                  const nextEntityType = event.target
                    .value as MappingEntityType;
                  setEntityType(nextEntityType);
                  setFieldName(FIELD_NAME_OPTIONS[nextEntityType][0] ?? "");
                  setPreviewed(null);
                }}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                <option value="product">Product</option>
                <option value="release">Release</option>
              </select>
            </label>
            <label
              className="flex flex-col gap-2 text-caption-1-regular text-fg"
              htmlFor="mapping-field-name"
            >
              Field name
              <select
                id="mapping-field-name"
                value={fieldName}
                onChange={(event) => {
                  setFieldName(event.target.value);
                  setPreviewed(null);
                }}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                {FIELD_NAME_OPTIONS[entityType].map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="flex flex-col gap-2 text-caption-1-regular text-fg"
              htmlFor="mapping-policy-value"
            >
              Authority policy
              <select
                id="mapping-policy-value"
                value={policyValue}
                onChange={(event) => {
                  const nextPolicyValue = event.target
                    .value as FieldAuthorityPolicyValue;
                  setPolicyValue(nextPolicyValue);
                  // A protected field can never be external-authoritative
                  // (enforced by the shared contract's schema too).
                  if (nextPolicyValue === "external_authoritative") {
                    setIsProtected(false);
                  }
                  setPreviewed(null);
                }}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                {POLICY_VALUE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-caption-1-regular text-fg">
              <input
                type="checkbox"
                checked={isProtected}
                onChange={(event) => {
                  setIsProtected(event.target.checked);
                  setPreviewed(null);
                }}
              />
              Protected field
            </label>
            {isProtected ? (
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
                Protected reason
                <textarea
                  value={protectedReason}
                  onChange={(event) => {
                    setProtectedReason(event.target.value);
                    setPreviewed(null);
                  }}
                  className="min-h-20 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
                />
              </label>
            ) : null}
            {previewed && previewFresh ? (
              <div className="sm:col-span-2">
                <PreviewSummary preview={previewed.preview} />
              </div>
            ) : null}
            {requiresOwner && !isOwner ? (
              <p
                role="alert"
                className="sm:col-span-2 text-caption-1-regular text-danger"
              >
                Only the organization owner can set external authority on a
                protected field, or unprotect it.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                tone="grey"
                onClick={() => void runPreview()}
                loading={preview.isPending}
                loadingLabel="Previewing impact"
              >
                Preview impact
              </Button>
              <Button
                type="button"
                onClick={() => void saveMapping()}
                disabled={!canSave}
                loading={save.isPending}
                loadingLabel="Saving mapping"
              >
                Save
              </Button>
            </div>
          </div>
        ) : null}
        {message ? (
          <p role="alert" className="text-caption-1-regular text-danger">
            {message}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
