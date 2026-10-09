"use client";
import { Button } from "@repo/ui/button";
import { useState } from "react";
import { useDeadLetterRecordsQuery } from "../../_features/connectors/sync-operations.queries";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import {
  OperationMessage,
  OperationPagination,
  operationDate,
} from "./connector-operation-ui";
import { ConnectorReplaySection } from "./connector-replay-section";
export function ConnectorDeadLettersSection({
  connectorId,
  canView,
  canEdit,
}: {
  connectorId: string;
  canView: boolean;
  canEdit: boolean;
}) {
  const [page, setPage] = useState(1);
  const [runId, setRunId] = useState<string | null>(null);
  const deadLetters = useDeadLetterRecordsQuery(
    connectorId,
    { page, pageSize: 25 },
    canView,
  );
  return (
    <SectionCard title="Dead letters">
      <div className="space-y-4">
        {!canView ? (
          <OperationMessage alert>
            You do not have permission to view dead letters.
          </OperationMessage>
        ) : deadLetters.isPending ? (
          <OperationMessage>Loading dead letters…</OperationMessage>
        ) : deadLetters.isError ? (
          <>
            <OperationMessage alert>
              Dead letters could not be loaded.
            </OperationMessage>
            <Button
              variant="outline"
              tone="grey"
              onClick={() => void deadLetters.refetch()}
            >
              Try again
            </Button>
          </>
        ) : !deadLetters.data?.records.rows.length ? (
          <OperationMessage>No failed sync records.</OperationMessage>
        ) : (
          <>
            <OperationMessage>
              Failed records block their whole batch. Withheld records have no
              committed effects.
            </OperationMessage>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-caption-1-regular text-fg">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-2">
                      Record
                    </th>
                    <th scope="col" className="p-2">
                      Outcome
                    </th>
                    <th scope="col" className="p-2">
                      Safe error
                    </th>
                    <th scope="col" className="p-2">
                      Dead-lettered
                    </th>
                    {canEdit ? (
                      <th scope="col" className="p-2">
                        Action
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.data.records.rows.map((record) => (
                    <tr key={record.id} className="border-b border-border">
                      <td className="p-2 break-all">
                        {record.entityType}: {record.externalId}
                      </td>
                      <td className="p-2 capitalize">{record.outcome}</td>
                      <td className="p-2">
                        {record.errorCategory ?? "Unknown"} ·{" "}
                        {record.errorCode ?? "Not recorded"}
                      </td>
                      <td className="p-2">
                        {operationDate(record.deadLetteredAt)}
                      </td>
                      {canEdit ? (
                        <td className="p-2">
                          <Button
                            variant="outline"
                            tone="grey"
                            aria-label={`Review replay for ${record.externalId}`}
                            onClick={() => setRunId(record.runId)}
                          >
                            Review replay
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <OperationPagination
              page={deadLetters.data.records.page}
              pageCount={deadLetters.data.records.pageCount}
              onPage={setPage}
            />
          </>
        )}
        {runId && canEdit && canView ? (
          <>
            <ConnectorReplaySection
              key={runId}
              connectorId={connectorId}
              runId={runId}
              canEdit={canEdit}
            />
            <Button
              variant="outline"
              tone="grey"
              onClick={() => setRunId(null)}
            >
              Close replay review
            </Button>
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
