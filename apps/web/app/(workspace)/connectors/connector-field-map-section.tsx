"use client";
import { useState } from "react";
import { Button } from "@repo/ui/button";
import type {
  ConnectorFieldMapping,
  ConnectorMappingPreview,
} from "@repo/contracts/connectors/types";
import {
  useFieldMapQuery,
  useFieldMapSchemaQuery,
  usePreviewFieldMapMutation,
  useSaveFieldMapMutation,
} from "../../_features/connectors/sync-operations.queries";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { OperationMessage, operationError } from "./connector-operation-ui";

export function ConnectorFieldMapSection({
  connectorId,
  connectorVersion,
  canView,
  canEdit,
}: {
  connectorId: string;
  connectorVersion: number;
  canView: boolean;
  canEdit: boolean;
}) {
  const mapping = useFieldMapQuery(connectorId, canView);
  const discovery = useFieldMapSchemaQuery(connectorId, canView);
  const previewMutation = usePreviewFieldMapMutation(connectorId);
  const save = useSaveFieldMapMutation(connectorId);
  const [draft, setDraft] = useState<{
    fields: ConnectorFieldMapping[];
    revision: number;
    version: number;
  } | null>(null);
  const [preview, setPreview] = useState<ConnectorMappingPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = mapping.data?.mapping;
  const schema = discovery.data?.schema;
  const fields = draft?.fields ?? current?.fields ?? [];
  const stale =
    draft !== null &&
    (draft.revision !== current?.revision ||
      draft.version !== connectorVersion);
  const pending = save.isPending || previewMutation.isPending;
  function edit(next: ConnectorFieldMapping[]) {
    setDraft({
      fields: next,
      revision: draft?.revision ?? current?.revision ?? 0,
      version: draft?.version ?? connectorVersion,
    });
    setPreview(null);
    setMessage(null);
  }
  async function previewMap() {
    setMessage(null);
    if (!draft)
      setDraft({
        fields,
        revision: current?.revision ?? 0,
        version: connectorVersion,
      });
    try {
      setPreview((await previewMutation.mutateAsync({ fields })).preview);
    } catch (error) {
      setPreview(null);
      setMessage(operationError(error, "Mapping preview could not be loaded."));
    }
  }
  async function saveMap() {
    if (!preview?.valid || !schema || !draft || stale) return;
    try {
      await save.mutateAsync({
        expectedVersion: draft.version,
        expectedMappingRevision: draft.revision,
        idempotencyKey: crypto.randomUUID(),
        schemaDigest: preview.schema.schemaDigest,
        fields: draft.fields,
      });
      setDraft(null);
      setPreview(null);
      setMessage("Field mapping saved. Later runs use the new revision.");
    } catch (error) {
      setPreview(null);
      setMessage(
        operationError(error, "The field mapping could not be saved."),
      );
    }
  }
  return (
    <SectionCard title="Source field mapping">
      <div className="space-y-4">
        {!canView ? (
          <OperationMessage alert>
            You do not have permission to view field mapping.
          </OperationMessage>
        ) : mapping.isPending || discovery.isPending ? (
          <OperationMessage>Loading field mapping…</OperationMessage>
        ) : mapping.isError || discovery.isError ? (
          <>
            <OperationMessage alert>
              Mapping discovery is unavailable. Your draft is preserved.
            </OperationMessage>
            <Button
              variant="outline"
              tone="grey"
              onClick={() => {
                void mapping.refetch();
                void discovery.refetch();
              }}
            >
              Retry mapping discovery
            </Button>
          </>
        ) : (
          <>
            <p className="text-subhead-regular text-fg-muted">
              Field map revision {current?.revision ?? "unknown"} · Adapter
              mapping {schema?.mappingVersion ?? "unknown"}. Identity
              assignments do not change field ownership.
            </p>
            {fields.length === 0 ? (
              <OperationMessage>
                No explicit field assignments. The adapter’s existing defaults
                apply.
              </OperationMessage>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-caption-1-regular text-fg">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="p-2">
                        Entity
                      </th>
                      <th scope="col" className="p-2">
                        Source field
                      </th>
                      <th scope="col" className="p-2">
                        Target field
                      </th>
                      {canEdit ? (
                        <th scope="col" className="p-2">
                          Action
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => (
                      <tr
                        key={`${index}:${field.entityType}`}
                        className="border-b border-border"
                      >
                        <td className="p-2">{field.entityType}</td>
                        <td className="p-2">
                          {canEdit ? (
                            <select
                              aria-label={`Source field ${index + 1}`}
                              value={field.sourceField}
                              disabled={pending}
                              onChange={(event) =>
                                edit(
                                  fields.map((value, at) =>
                                    at === index
                                      ? {
                                          ...value,
                                          sourceField: event.target.value,
                                        }
                                      : value,
                                  ),
                                )
                              }
                              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                            >
                              {!schema?.sources
                                .find(
                                  (entity) =>
                                    entity.entityType === field.entityType,
                                )
                                ?.fields.some(
                                  (source) =>
                                    source.field === field.sourceField &&
                                    !source.sensitive,
                                ) ? (
                                <option value={field.sourceField}>
                                  {field.sourceField} (unavailable; review
                                  required)
                                </option>
                              ) : null}
                              {schema?.sources
                                .find(
                                  (entity) =>
                                    entity.entityType === field.entityType,
                                )
                                ?.fields.filter((source) => !source.sensitive)
                                .map((source) => (
                                  <option
                                    key={source.field}
                                    value={source.field}
                                  >
                                    {source.field} ({source.type}
                                    {source.nullable ? ", nullable" : ""})
                                  </option>
                                ))}
                            </select>
                          ) : (
                            field.sourceField
                          )}
                        </td>
                        <td className="p-2">{field.targetField}</td>
                        {canEdit ? (
                          <td className="p-2">
                            <Button
                              variant="outline"
                              tone="grey"
                              aria-label={`Remove assignment ${index + 1}`}
                              disabled={pending}
                              onClick={() =>
                                edit(fields.filter((_, at) => at !== index))
                              }
                            >
                              Remove
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit ? (
              <>
                <div className="flex flex-wrap gap-3">
                  {schema?.targets.flatMap((entity) =>
                    entity.fields
                      .filter(
                        (target) =>
                          !target.sensitive &&
                          !fields.some(
                            (value) =>
                              value.entityType === entity.entityType &&
                              value.targetField === target.field,
                          ),
                      )
                      .map((target) => (
                        <Button
                          key={`${entity.entityType}:${target.field}`}
                          variant="outline"
                          tone="grey"
                          disabled={pending || fields.length >= 32}
                          onClick={() => {
                            const source = schema.sources
                              .find(
                                (value) =>
                                  value.entityType === entity.entityType,
                              )
                              ?.fields.find(
                                (value) =>
                                  !value.sensitive &&
                                  value.type === target.type,
                              );
                            if (source)
                              edit([
                                ...fields,
                                {
                                  entityType: entity.entityType,
                                  sourceField: source.field,
                                  targetField: target.field,
                                  transform: "identity",
                                },
                              ]);
                          }}
                        >
                          Map {entity.entityType}.{target.field}
                          {target.required ? " (required)" : ""}
                        </Button>
                      )),
                  )}
                </div>
                {stale ? (
                  <>
                    <OperationMessage alert>
                      Current data changed. Your draft is preserved. Explicitly
                      reapply it before previewing.
                    </OperationMessage>
                    <Button
                      variant="outline"
                      tone="grey"
                      onClick={() => {
                        setDraft({
                          fields,
                          revision: current?.revision ?? 0,
                          version: connectorVersion,
                        });
                        setPreview(null);
                      }}
                    >
                      Reapply draft to current revision
                    </Button>
                  </>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    tone="grey"
                    disabled={pending || stale}
                    onClick={() => void previewMap()}
                    loading={previewMutation.isPending}
                    loadingLabel="Previewing field mapping"
                  >
                    Preview field mapping
                  </Button>
                  <Button
                    disabled={pending || stale || !preview?.valid}
                    onClick={() => void saveMap()}
                    loading={save.isPending}
                    loadingLabel="Saving field mapping"
                  >
                    Save field mapping
                  </Button>
                  {draft ? (
                    <Button
                      variant="outline"
                      tone="grey"
                      disabled={pending}
                      onClick={() => {
                        setDraft(null);
                        setPreview(null);
                        setMessage(null);
                      }}
                    >
                      Discard field mapping draft
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
            {preview ? (
              <div aria-live="polite">
                <OperationMessage alert={!preview.valid}>
                  {preview.valid
                    ? "Mapping preview is valid."
                    : "Resolve mapping errors before saving."}
                </OperationMessage>
                {preview.issues.map((issue, index) => (
                  <p key={index} className="text-caption-1-regular text-danger">
                    {issue.recordId ? `${issue.recordId}: ` : ""}
                    {issue.message}
                  </p>
                ))}
                {preview.samples.length ? (
                  <ul
                    aria-label="Mapped samples"
                    className="divide-y divide-border"
                  >
                    {preview.samples.map((sample) => (
                      <li
                        key={`${sample.entityType}:${sample.externalId}`}
                        className="py-2 text-caption-1-regular text-fg"
                      >
                        {sample.externalId}: {JSON.stringify(sample.fields)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <OperationMessage>
                    No retained sample records are available.
                  </OperationMessage>
                )}
              </div>
            ) : null}
          </>
        )}
        {message ? (
          <OperationMessage alert={!message.startsWith("Field mapping saved")}>
            {message}
          </OperationMessage>
        ) : null}
      </div>
    </SectionCard>
  );
}
