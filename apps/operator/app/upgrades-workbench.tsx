"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { upgradesGateway, type UpgradesGateway } from "./upgrades-gateway";
import { OperatorRequestError } from "./operator-gateway";
type Gateway = Pick<
  UpgradesGateway,
  | "capabilities"
  | "media"
  | "history"
  | "stage"
  | "preflight"
  | "apply"
  | "rollback"
  | "reconcile"
  | "result"
  | "detail"
>;
type Run = Awaited<ReturnType<Gateway["history"]>>["items"][number];
type Review = Awaited<ReturnType<Gateway["preflight"]>>;
const remediation: Readonly<Record<Review["checks"][number]["code"], string>> =
  {
    signature:
      "Obtain media signed by a trusted release signer; ask the operator administrator to review the mounted trust policy.",
    inventory:
      "Obtain a complete signed release artifact and remount it; do not edit staged files.",
    platform:
      "Obtain a qualified release for this host operating system and architecture.",
    compatibility:
      "Obtain a qualified intermediate release artifact for the installed version, then run preflight again.",
    infrastructure:
      "Review the pinned infrastructure image digests with the operator administrator before continuing.",
    supervisor:
      "Use a release qualified for the installed independent supervisor version.",
    schema:
      "Reconcile the installed schema against the qualified release ledger; retain maintenance until compatibility is established.",
    "migration-ledger":
      "Review the migration ledger with the operator administrator; do not repeat uncertain migrations or reverse source data.",
    backup:
      "Provide a recent verified backup capture and confirm its historical decryption keys remain available and held against cleanup.",
    key: "Make the required historical decryption keys available through the approved private key mounts, then verify the backup again.",
    disk: "Free reviewed staging and image capacity without deleting retained source data, held backups or upgrade evidence; run preflight again.",
    memory:
      "Provide the reviewed memory capacity on the qualified host, then run preflight again.",
    maintenance:
      "Resolve the concurrent maintenance operation and confirm its effects before retrying preflight.",
    writers:
      "Stop or register unmanaged writers and positively confirm all in-flight effects have drained.",
    license:
      "Review the instance entitlements and signed licence evidence without changing existing approval or licence decisions.",
    rollback:
      "Retain the exact previous compatible images and obtain a release with qualified image-only rollback compatibility.",
  };
function reviewMatchesRun(
  review: Review | undefined,
  run: Run | undefined,
): boolean {
  return (
    !!review &&
    !!run &&
    run.id === review.runId &&
    run.version === review.version &&
    run.preflight?.fingerprint === review.fingerprint &&
    Date.parse(review.expiresAt) > Date.now() &&
    run.state === "awaiting-initiation"
  );
}
type Snapshot = {
  capabilities: Awaited<ReturnType<Gateway["capabilities"]>>;
  media: Awaited<ReturnType<Gateway["media"]>>;
  history: Awaited<ReturnType<Gateway["history"]>>;
};
export function UpgradesWorkbench({
  instanceId,
  authorityEpoch = "",
  gateway = upgradesGateway,
}: {
  instanceId: string;
  authorityEpoch?: string;
  gateway?: Gateway;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [mediaId, setMediaId] = useState("");
  const [run, setRun] = useState<Run>();
  const [review, setReview] = useState<Review>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const historyTarget = useRef<string | undefined>(undefined);
  const historyRequest = useRef<AbortController | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyCursor, setHistoryCursor] = useState<string>();
  const selectedRun = useRef<Run | undefined>(undefined);
  const selectedReview = useRef<Review | undefined>(undefined);
  useEffect(() => {
    selectedReview.current = review;
  }, [review]);
  useEffect(() => {
    selectedRun.current = run;
  }, [run]);
  const commands = useRef(new Map<string, string>());
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    historyRequest.current?.abort();
    setHistoryCursor(undefined);
    setHistoryError("");
    setHistoryBusy(false);
    selectedRun.current = undefined;
    selectedReview.current = undefined;
    setReview(undefined);
    setAcknowledged(false);
    setSnapshot(undefined);
    setRun(undefined);
    setMediaId("");
    commands.current.clear();
  }, [instanceId, authorityEpoch]);
  useEffect(() => {
    const authority = epoch;
    const generation = ++authority.current;
    controller.current?.abort();
    historyRequest.current?.abort();
    setHistoryBusy(false);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    Promise.all([
      gateway.capabilities(instanceId, abort.signal),
      gateway.media(instanceId, abort.signal),
      gateway.history(instanceId, abort.signal),
      selectedRun.current
        ? gateway.detail(instanceId, selectedRun.current.id, abort.signal)
        : Promise.resolve(undefined),
    ])
      .then(([capabilities, media, history, detail]) => {
        if (generation !== epoch.current) return;
        setSnapshot({ capabilities, media, history });
        setRun(detail);
        if (
          !reviewMatchesRun(selectedReview.current, detail) ||
          !capabilities.enabled ||
          !capabilities.actions.includes("upgrades.apply")
        ) {
          setReview(undefined);
          setAcknowledged(false);
        }
        setHistoryCursor(undefined);
        setHistoryError("");
        setError("");
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "Upgrade status is unavailable. Refresh status before continuing; your media selection is preserved.",
          );
      })
      .finally(() => {
        if (generation === epoch.current) setBusy(false);
      });
    return () => {
      abort.abort();
      historyRequest.current?.abort();
      authority.current++;
    };
  }, [instanceId, authorityEpoch, gateway, refresh]);
  async function browseHistory(cursor?: string) {
    historyTarget.current = cursor;
    historyRequest.current?.abort();
    const abort = new AbortController();
    historyRequest.current = abort;
    const generation = epoch.current;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const history = await gateway.history(instanceId, abort.signal, {
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      if (abort.signal.aborted || generation !== epoch.current) return;
      setSnapshot((current) => (current ? { ...current, history } : current));
      setHistoryCursor(cursor);
    } catch {
      if (!abort.signal.aborted && generation === epoch.current)
        setHistoryError(
          "History is unavailable. Retry this page; your selected run and review are preserved.",
        );
    } finally {
      if (!abort.signal.aborted && generation === epoch.current)
        setHistoryBusy(false);
    }
  }
  const allowed = (
    action: "upgrades.stage" | "upgrades.apply" | "upgrades.rollback",
  ) =>
    !error &&
    !!snapshot?.capabilities.enabled &&
    snapshot.capabilities.actions.includes(action);
  async function perform(action: () => Promise<Run | Review | void>) {
    const generation = epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (generation !== epoch.current) return;
      if (result && "fingerprint" in result) {
        setReview(result);
        setRun((current) =>
          current ? { ...current, version: result.version } : current,
        );
        setAcknowledged(false);
      } else if (result) {
        setRun(result);
        if (!reviewMatchesRun(selectedReview.current, result)) {
          setReview(undefined);
          setAcknowledged(false);
        }
      }
      heading.current?.focus();
    } catch (error) {
      if (generation !== epoch.current) return;
      setReview(undefined);
      setAcknowledged(false);
      setError(
        error instanceof OperatorRequestError &&
          [401, 403, 404].includes(error.status)
          ? "Your certificate no longer authorizes this action. Refresh status to review current authority."
          : "The action was not confirmed. Refresh status and reconcile the run before retrying. No action is replayed automatically.",
      );
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  const mutation = (action: string) => {
    const expectedVersion = run?.version ?? snapshot?.capabilities.version ?? 0;
    const key = `${instanceId}:${authorityEpoch}:${action}:${run?.id ?? mediaId}:${expectedVersion}`;
    let idempotencyKey = commands.current.get(key);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      commands.current.set(key, idempotencyKey);
    }
    return { expectedVersion, idempotencyKey };
  };
  const reviewCurrent =
    !!review && review.eligible && Date.parse(review.expiresAt) > clock;
  return (
    <section
      aria-labelledby="upgrades-heading"
      className={cn(
        "flex flex-col gap-5 rounded-lg border border-border bg-surface p-5",
      )}
    >
      <div className={cn("flex flex-wrap items-center justify-between gap-3")}>
        <h2
          id="upgrades-heading"
          tabIndex={-1}
          ref={heading}
          className={cn("text-h3 text-fg")}
        >
          Application upgrades
        </h2>
        <Button
          variant="outline"
          tone="grey"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh upgrade status
        </Button>
      </div>
      <p className={cn("max-w-prose text-subhead-regular text-fg-muted")}>
        Use signed release media mounted by your operator administrator.
        Rollback changes compatible application images only; source data and
        forward migrations remain in place.
      </p>
      {busy ? (
        <p role="status">Waiting for the private upgrade controller…</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {snapshot ? (
        <>
          <p className={cn("text-subhead-regular")}>
            Current release:{" "}
            {snapshot.capabilities.currentVersion ?? "unavailable"}.
            Maintenance:{" "}
            {snapshot.capabilities.maintenance ? "retained" : "inactive"}.{" "}
            {snapshot.capabilities.enabled
              ? "Upgrade control enabled."
              : "Upgrade control disabled; provision and qualify the host runtime first."}
          </p>
          <div className={cn("flex flex-col gap-2 text-subhead-regular")}>
            <label htmlFor="upgrade-media">Mounted signed release</label>
            <select
              id="upgrade-media"
              value={mediaId}
              disabled={busy}
              className={cn(
                "rounded-md border border-border bg-canvas p-3 text-fg focus-visible:outline focus-visible:outline-2",
              )}
              onChange={(event) => {
                setMediaId(event.target.value);
                setRun(undefined);
                setReview(undefined);
                setAcknowledged(false);
              }}
            >
              <option value="">Select mounted media</option>
              {snapshot.media.items.map((media) => (
                <option key={media.id} value={media.id}>
                  {media.label} ({media.bytes} bytes)
                </option>
              ))}
            </select>
          </div>
          {!snapshot.media.items.length ? (
            <p>No mounted release media is available.</p>
          ) : null}
          <div className={cn("flex flex-wrap gap-3")}>
            <Button
              disabled={busy || !mediaId || !allowed("upgrades.stage")}
              onClick={() =>
                void perform(() =>
                  gateway.stage(
                    instanceId,
                    { ...mutation("stage"), mediaId },
                    controller.current?.signal,
                  ),
                )
              }
            >
              Verify and stage release
            </Button>
            <Button
              variant="outline"
              tone="grey"
              disabled={busy || !run || !allowed("upgrades.stage")}
              onClick={() =>
                void perform(() =>
                  gateway.preflight(
                    instanceId,
                    run!.id,
                    mutation("preflight"),
                    controller.current?.signal,
                  ),
                )
              }
            >
              Run preflight checks
            </Button>
          </div>
          {run ? (
            <p role="status">
              Run {run.id}: {run.state}. Release {run.fromVersion ?? "unknown"}{" "}
              → {run.toVersion ?? "unverified"}. {run.failureCode ?? ""}
            </p>
          ) : null}
          {run &&
          !run.result &&
          !["preflight", "awaiting-initiation", "failed"].includes(
            run.state,
          ) ? (
            <p role="status">
              The supervisor continues independently. Refresh upgrade status to
              read progress and the completed result; do not repeat an
              unconfirmed action.
            </p>
          ) : null}
          {run?.result ? (
            <p role="status">
              Recorded outcome: {run.result.outcome}. Maintenance{" "}
              {run.result.maintenanceRetained ? "retained" : "released"}.
              Exposure{" "}
              {run.result.exposurePossible ? "possible" : "not recorded"}. Data
              was not restored; migrations were not reversed.
            </p>
          ) : null}
          {review ? (
            <div className={cn("flex flex-col gap-3")}>
              <h3 className={cn("text-subhead-regular")}>Preflight review</h3>
              <p>
                Release {review.summary.fromVersion} →{" "}
                {review.summary.toVersion}. Expected outage:{" "}
                {review.summary.expectedOutageSeconds} seconds. Licence effects:{" "}
                {review.summary.licenseEffects.join(", ")}. Rollback replaces
                compatible images before exposure; data is not restored and
                migrations are not reversed.
              </p>
              <ul>
                {review.checks.map((check) => (
                  <li key={check.code}>
                    {check.code}: {check.status} ({check.detail})
                    {check.status !== "passed" ? (
                      <p>{remediation[check.code]}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p>
                Review expires{" "}
                <time dateTime={review.expiresAt}>
                  {new Date(review.expiresAt).toLocaleString()}
                </time>
                .{" "}
                {reviewCurrent
                  ? "Checks permit initiation."
                  : "Initiation blocked; run fresh checks."}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />{" "}
                I reviewed the preflight checks and understand rollback does not
                restore data.
              </label>
            </div>
          ) : null}
          <div className={cn("flex flex-wrap gap-3")}>
            <Button
              disabled={
                busy ||
                !run ||
                !reviewCurrent ||
                !acknowledged ||
                !allowed("upgrades.apply")
              }
              onClick={() =>
                void perform(() =>
                  gateway.apply(
                    instanceId,
                    run!.id,
                    {
                      ...mutation("apply"),
                      expectedVersion: review!.version,
                      fingerprint: review!.fingerprint,
                      acknowledgedEffects: true,
                    },
                    controller.current?.signal,
                  ),
                )
              }
            >
              Initiate reviewed upgrade
            </Button>
            <Button
              variant="outline"
              tone="grey"
              disabled={busy || !run || !allowed("upgrades.apply")}
              onClick={() =>
                void perform(() =>
                  gateway.reconcile(
                    instanceId,
                    run!.id,
                    mutation("reconcile"),
                    controller.current?.signal,
                  ),
                )
              }
            >
              Reconcile run
            </Button>
            <Button
              variant="outline"
              tone="grey"
              disabled={
                busy ||
                !run ||
                !allowed("upgrades.rollback") ||
                run.result?.exposurePossible !== false ||
                !["rollback-required", "failed"].includes(run.state)
              }
              onClick={() =>
                void perform(() =>
                  gateway.rollback(
                    instanceId,
                    run!.id,
                    mutation("rollback"),
                    controller.current?.signal,
                  ),
                )
              }
            >
              Roll back compatible images
            </Button>
          </div>
          <h3 className={cn("text-subhead-regular")}>Upgrade history</h3>
          {historyError ? <p role="alert">{historyError}</p> : null}
          {historyBusy ? <p role="status">Loading upgrade history…</p> : null}
          {snapshot.history.items.length ? (
            <ul className={cn("flex flex-col gap-3")}>
              {snapshot.history.items.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="outline"
                    tone="grey"
                    disabled={busy}
                    onClick={() =>
                      void perform(() =>
                        gateway.detail(
                          instanceId,
                          item.id,
                          controller.current?.signal,
                        ),
                      )
                    }
                  >
                    {item.toVersion ?? "Unverified release"}: {item.state}
                  </Button>
                  {item.result ? (
                    <Button
                      variant="outline"
                      tone="grey"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const generation = epoch.current;
                          const result = await gateway.result(
                            instanceId,
                            item.id,
                            controller.current?.signal,
                          );
                          if (generation !== epoch.current) return;
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(result, null, 2)], {
                              type: "application/json",
                            }),
                          );
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = `upgrade-${item.id}.json`;
                          link.click();
                          URL.revokeObjectURL(url);
                        })
                      }
                    >
                      Download redacted result
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No upgrade runs have been recorded.</p>
          )}
          <div className={cn("flex flex-wrap gap-3")}>
            {snapshot.history.nextCursor ? (
              <Button
                variant="outline"
                tone="grey"
                disabled={busy || historyBusy}
                onClick={() => void browseHistory(snapshot.history.nextCursor!)}
              >
                Next history page
              </Button>
            ) : null}
            {historyCursor ? (
              <Button
                variant="outline"
                tone="grey"
                disabled={busy || historyBusy}
                onClick={() => void browseHistory()}
              >
                First history page
              </Button>
            ) : null}
            {historyError ? (
              <Button
                variant="outline"
                tone="grey"
                disabled={busy || historyBusy}
                onClick={() => void browseHistory(historyTarget.current)}
              >
                Retry history page
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
