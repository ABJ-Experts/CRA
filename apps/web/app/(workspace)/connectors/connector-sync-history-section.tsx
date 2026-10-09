"use client";
import { useState } from "react";
import { Button } from "@repo/ui/button";
import {
  useSyncHistoryQuery,
  useSyncDetailQuery,
} from "../../_features/connectors/sync-operations.queries";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import {
  OperationMessage,
  OperationPagination,
  operationDate,
} from "./connector-operation-ui";
import { ConnectorReplaySection } from "./connector-replay-section";

function RunHistoryDetail({
  connectorId,
  runId,
  canEdit,
}: {
  connectorId: string;
  runId: string;
  canEdit: boolean;
}) {
  const [page, setPage] = useState(1);
  const [reviewReplay, setReviewReplay] = useState(false);
  const detail = useSyncDetailQuery(
    connectorId,
    runId,
    { page, pageSize: 25 },
    true,
  );
  if (detail.isPending)
    return <OperationMessage>Loading run details…</OperationMessage>;
  if (detail.isError)
    return (
      <>
        <OperationMessage alert>
          Run details could not be loaded.
        </OperationMessage>
        <Button
          variant="outline"
          tone="grey"
          onClick={() => void detail.refetch()}
        >
          Retry run details
        </Button>
      </>
    );
  if (!detail.data) return null;
  const { attempts, records, run } = detail.data;
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <dl className="grid gap-2 text-caption-1-regular text-fg sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Run</dt>
          <dd className="break-all">{run.run.id}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Correlation ID</dt>
          <dd className="break-all">{run.run.correlationId}</dd>
        </div>
      </dl>
      {canEdit && run.run.status === "failed" ? (
        <>
          <Button
            variant="outline"
            tone="grey"
            onClick={() => setReviewReplay((value) => !value)}
          >
            {reviewReplay ? "Close replay review" : "Review replay"}
          </Button>
          {reviewReplay ? (
            <ConnectorReplaySection
              connectorId={connectorId}
              runId={runId}
              canEdit={canEdit}
            />
          ) : null}
        </>
      ) : null}
      <h3 className="text-headline-semibold text-fg">Attempts</h3>
      {!attempts.rows.length ? (
        <OperationMessage>
          No attempt details were retained for this run.
        </OperationMessage>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label="Attempts"
            className="w-full text-left text-caption-1-regular text-fg"
          >
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="p-2">
                  Generation / phase
                </th>
                <th scope="col" className="p-2">
                  Start / end
                </th>
                <th scope="col" className="p-2">
                  Outcome
                </th>
                <th scope="col" className="p-2">
                  Safe error
                </th>
                <th scope="col" className="p-2">
                  Next attempt
                </th>
              </tr>
            </thead>
            <tbody>
              {attempts.rows.map((attempt) => (
                <tr key={attempt.id} className="border-b border-border">
                  <td className="p-2">
                    {attempt.generation} · {attempt.phase}
                  </td>
                  <td className="p-2">
                    {operationDate(attempt.startedAt)}
                    <br />
                    {operationDate(attempt.finishedAt)}
                  </td>
                  <td className="p-2 capitalize">
                    {attempt.outcome.replaceAll("_", " ")}
                  </td>
                  <td className="p-2">
                    {attempt.errorCategory ?? "—"}
                    <br />
                    {attempt.errorCode ?? "—"}
                  </td>
                  <td className="p-2">
                    {operationDate(attempt.nextAttemptAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="text-headline-semibold text-fg">Record outcomes</h3>
      {!records.rows.length ? (
        <OperationMessage>
          No record details were retained for this run.
        </OperationMessage>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label="Record outcomes"
            className="w-full text-left text-caption-1-regular text-fg"
          >
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="p-2">
                  Record
                </th>
                <th scope="col" className="p-2">
                  Action
                </th>
                <th scope="col" className="p-2">
                  Outcome
                </th>
                <th scope="col" className="p-2">
                  Safe error
                </th>
              </tr>
            </thead>
            <tbody>
              {records.rows.map((record) => (
                <tr key={record.id} className="border-b border-border">
                  <td className="p-2 break-all">{record.externalId}</td>
                  <td className="p-2">
                    {record.proposedAction?.replaceAll("_", " ")}
                  </td>
                  <td className="p-2 capitalize">{record.outcome}</td>
                  <td className="p-2">
                    {record.errorCategory ?? "—"} · {record.errorCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OperationPagination
        page={page}
        pageCount={Math.max(records.pageCount, attempts.pageCount)}
        onPage={setPage}
      />
    </div>
  );
}
export function ConnectorSyncHistorySection({
  connectorId,
  canView,
  canEdit = false,
}: {
  connectorId: string;
  canView: boolean;
  canEdit?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [runId, setRunId] = useState<string | null>(null);
  const history = useSyncHistoryQuery(
    connectorId,
    { page, pageSize: 15 },
    canView,
  );
  return (
    <SectionCard title="Sync history">
      <div className="space-y-4">
        {!canView ? (
          <OperationMessage alert>
            You do not have permission to view sync history.
          </OperationMessage>
        ) : history.isPending ? (
          <OperationMessage>Loading sync history…</OperationMessage>
        ) : history.isError ? (
          <>
            <OperationMessage alert>
              Sync history could not be loaded.
            </OperationMessage>
            <Button
              variant="outline"
              tone="grey"
              onClick={() => void history.refetch()}
            >
              Retry sync history
            </Button>
          </>
        ) : !history.data?.runs.rows.length ? (
          <OperationMessage>No sync history yet.</OperationMessage>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table
                aria-label="Sync history"
                className="w-full text-left text-caption-1-regular text-fg"
              >
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-2">
                      Status
                    </th>
                    <th scope="col" className="p-2">
                      Started
                    </th>
                    <th scope="col" className="p-2">
                      Finished
                    </th>
                    <th scope="col" className="p-2">
                      Record counts
                    </th>
                    <th scope="col" className="p-2">
                      Versions
                    </th>
                    <th scope="col" className="p-2">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.runs.rows.map((item) => (
                    <tr key={item.run.id} className="border-b border-border">
                      <td className="p-2">
                        {item.run.status.replaceAll("_", " ")}
                        {item.replayOfRunId ? (
                          <span className="block text-fg-muted">
                            Reviewed replay
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2">{operationDate(item.startedAt)}</td>
                      <td className="p-2">{operationDate(item.finishedAt)}</td>
                      <td className="p-2 tabular-nums">
                        {item.counts.succeeded} succeeded ·{" "}
                        {item.counts.skipped} skipped · {item.counts.failed}{" "}
                        failed · {item.counts.pending} pending
                      </td>
                      <td className="p-2">
                        Adapter {item.run.adapterVersion}
                        <br />
                        Adapter mapping {item.run.mappingVersion}
                        <br />
                        Field map {item.fieldMappingRevision ?? "not recorded"}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="outline"
                          tone="grey"
                          aria-label={`View run details ${item.run.id}`}
                          onClick={() => setRunId(item.run.id)}
                        >
                          View run details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <OperationPagination
              page={history.data.runs.page}
              pageCount={history.data.runs.pageCount}
              onPage={setPage}
            />
          </>
        )}
        {runId && canView ? (
          <>
            <RunHistoryDetail
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
              Close run details
            </Button>
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
