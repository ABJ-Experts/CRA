"use client";
import { useEffect, useRef, useState } from "react";
import { backupPolicyInputSchema } from "@repo/contracts/backups/schemas";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { backupsGateway, type BackupsGateway } from "./backups-gateway";
import { OperatorRequestError } from "./operator-gateway";
import { BackupsRuns } from "./backups-runs";

type Gateway = Pick<
  BackupsGateway,
  | "policy"
  | "history"
  | "validate"
  | "save"
  | "run"
  | "detail"
  | "cancel"
  | "verify"
  | "cleanupReview"
  | "cleanup"
>;
type Policy = NonNullable<Awaited<ReturnType<Gateway["policy"]>>>;
type History = Awaited<ReturnType<Gateway["history"]>>;
type Validation = Awaited<ReturnType<Gateway["validate"]>>;
type Review = Awaited<ReturnType<Gateway["cleanupReview"]>>;
type Run = History["items"][number];
const initial = {
  sourceAlias: "local-source",
  repositoryAlias: "off-host",
  stagingAlias: "private-ram",
  keyAlias: "backup-key-v1",
  targetProfile: "isolated-saas",
  residency: "local",
  schedulingEnabled: false,
  checkpointIntervalMinutes: 30,
  baseIntervalHours: 24,
  verificationIntervalDays: 30,
  retentionDays: 30,
  pauseLimitSeconds: 120,
};
const fields = [
  ["sourceAlias", "Source alias"],
  ["repositoryAlias", "Repository alias"],
  ["stagingAlias", "Private staging alias"],
  ["keyAlias", "Backup key alias"],
  ["targetProfile", "Isolated target profile"],
  ["residency", "Declared residency"],
] as const;
export function backupFailure(error: unknown) {
  if (
    error instanceof OperatorRequestError &&
    [401, 403, 404].includes(error.status)
  )
    return "Your current certificate grant does not authorize this backup action. Ask your operator administrator for an explicit instance-bound grant.";
  if (error instanceof OperatorRequestError && error.status === 409)
    return "Configuration or recovery authority changed. Your draft is preserved. Refresh backup status, review the current version and validate again.";
  return "The backup action could not complete safely. Review the mounted configuration and retry. No recovery assurance has been claimed.";
}

export function BackupsWorkbench(props: {
  instanceId: string;
  gateway?: Gateway;
}) {
  return <ScopedBackupsWorkbench key={props.instanceId} {...props} />;
}
function ScopedBackupsWorkbench({
  instanceId,
  gateway = backupsGateway,
}: {
  instanceId: string;
  gateway?: Gateway;
}) {
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [snapshot, setSnapshot] = useState<{
    policy: Policy | null;
    history: History;
  } | null>(null);
  const [draft, setDraft] = useState(initial);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validated, setValidated] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const authorityEpoch = useRef(0);
  const initialized = useRef(false);
  const executing = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const mutation = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = authorityEpoch.current;
    void Promise.all([
      gateway.policy(instanceId, controller.signal),
      gateway.history(instanceId, cursor ? { cursor } : {}, controller.signal),
    ])
      .then(([policy, history]) => {
        if (controller.signal.aborted || epoch !== authorityEpoch.current)
          return;
        setSnapshot({ policy, history });
        if (!initialized.current) {
          setDraft(policy?.configuration ?? initial);
          initialized.current = true;
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && epoch === authorityEpoch.current) {
          if (
            failure instanceof OperatorRequestError &&
            [401, 403, 404].includes(failure.status)
          )
            clearAuthority();
          setError(failure);
        }
      });
    const timer = window.setInterval(
      () => setAttempt((value) => value + 1),
      10_000,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [instanceId, gateway, attempt, cursor]);

  function clearAuthority() {
    authorityEpoch.current += 1;
    setSnapshot(null);
    setDraft(initial);
    initialized.current = false;
    setValidation(null);
    setValidated("");
    setReview(null);
    setNotice("");
    mutation.current = null;
  }
  function identity(signature: string) {
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, id: crypto.randomUUID() };
    return mutation.current.id;
  }
  async function execute(
    action: (signal: AbortSignal, epoch: number) => Promise<void>,
  ) {
    if (executing.current || !lifetime.current) return;
    executing.current = true;
    const epoch = authorityEpoch.current;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action(lifetime.current.signal, epoch);
      if (!lifetime.current.signal.aborted && epoch === authorityEpoch.current)
        mutation.current = null;
    } catch (failure: unknown) {
      if (
        !lifetime.current.signal.aborted &&
        epoch === authorityEpoch.current
      ) {
        setError(failure);
        if (
          failure instanceof OperatorRequestError &&
          [401, 403, 404].includes(failure.status)
        )
          clearAuthority();
      }
    } finally {
      executing.current = false;
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  }
  const draftKey = JSON.stringify(draft);
  const policyVersion = snapshot?.policy?.version ?? 0;
  const validationPending =
    validation !== null &&
    !validation.valid &&
    validation.checks.some((check) => check.status === "unavailable") &&
    !validation.checks.some((check) => check.status === "failed");
  function policyBody() {
    return backupPolicyInputSchema.parse({
      expectedVersion: policyVersion,
      idempotencyKey: identity(`policy:${policyVersion}:${draftKey}`),
      configuration: draft,
    });
  }
  function mutateRun(
    run: Run,
    action: "cancel" | "verify" | "review" | "cleanup",
  ) {
    void execute(async (signal, epoch) => {
      const body = {
        expectedVersion: run.version,
        idempotencyKey: identity(`${action}:${run.id}:${run.version}`),
      };
      if (action === "review") {
        const result = await gateway.cleanupReview(
          instanceId,
          run.id,
          { expectedVersion: run.version },
          signal,
        );
        if (!signal.aborted && epoch === authorityEpoch.current)
          setReview(result);
        return;
      }
      if (action === "verify")
        await gateway.verify(
          instanceId,
          run.id,
          {
            ...body,
            targetProfile:
              snapshot?.policy?.configuration.targetProfile ??
              draft.targetProfile,
          },
          signal,
        );
      else if (
        action === "cleanup" &&
        review?.runId === run.id &&
        review.eligible
      ) {
        await gateway.cleanup(
          instanceId,
          run.id,
          {
            ...body,
            expectedVersion: review.version,
            reviewFingerprint: review.reviewFingerprint,
          },
          signal,
        );
        if (!signal.aborted && epoch === authorityEpoch.current)
          setReview(null);
      } else if (action === "cancel")
        await gateway.cancel(instanceId, run.id, body, signal);
      if (signal.aborted || epoch !== authorityEpoch.current) return;
      setNotice("Backup request recorded. Status will refresh.");
      setAttempt((value) => value + 1);
    });
  }
  return (
    <section
      aria-labelledby="encrypted-backups-heading"
      className={cn("flex min-w-0 flex-col gap-5 border-t border-border pt-6")}
    >
      <div className={cn("flex flex-wrap items-start justify-between gap-3")}>
        <div>
          <h2 id="encrypted-backups-heading" className={cn("text-h4")}>
            Encrypted backups and restore verification
          </h2>
          <p
            className={cn(
              "mt-2 max-w-[72ch] text-subhead-regular text-fg-muted",
            )}
          >
            Whole-deployment protection requires an explicit operator grant.
            Capturing a backup and verifying a clean restore are separate
            results. No production restore is available here.
          </p>
        </div>
        <Button
          variant="outline"
          tone="grey"
          disabled={busy}
          onClick={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          Refresh backup status
        </Button>
      </div>
      {error ? (
        <div
          role="alert"
          className={cn(
            "rounded-lg border border-border bg-surface p-4 text-subhead-regular",
          )}
        >
          <p>{backupFailure(error)}</p>
          <Button
            className={cn("mt-3")}
            variant="outline"
            tone="grey"
            disabled={busy}
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry backup access
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className={cn("text-subhead-regular")}>
          {notice}
        </p>
      ) : null}
      {!snapshot ? (
        !error ? (
          <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
            Loading authorized backup configuration…
          </p>
        ) : null
      ) : (
        <>
          <form
            className={cn("flex flex-col gap-4")}
            onSubmit={(event) => {
              event.preventDefault();
              void execute(async (signal, epoch) => {
                const result = await gateway.validate(
                  instanceId,
                  { configuration: draft },
                  signal,
                );
                if (signal.aborted || epoch !== authorityEpoch.current) return;
                setValidation(result);
                setValidated(`${policyVersion}:${draftKey}`);
              });
            }}
          >
            <p className={cn("text-subhead-regular text-fg-muted")}>
              Use approved mounted aliases only. Paths, credentials and commands
              are never accepted. Encryption keys remain separate from the
              off-host repository.
            </p>
            <fieldset
              disabled={busy}
              className={cn("grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3")}
            >
              <legend className={cn("mb-3 text-subhead-semibold")}>
                Backup configuration{" "}
                {snapshot.policy
                  ? `(revision ${snapshot.policy.configurationRevision})`
                  : "(not configured)"}
              </legend>
              {fields.map(([key, title]) => (
                <label
                  key={key}
                  className={cn(
                    "flex min-w-0 flex-col gap-2 text-subhead-regular",
                  )}
                >
                  {title}
                  <input
                    required
                    value={draft[key]}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    pattern="[a-z][a-z0-9_-]{0,63}"
                    title="Use a mounted alias with lowercase letters, numbers, underscores or hyphens."
                    onChange={(event) => {
                      setDraft((value) => ({
                        ...value,
                        [key]: event.target.value,
                      }));
                      setValidation(null);
                    }}
                    className={cn(
                      "min-w-0 rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular focus-visible:outline-2 focus-visible:outline-accent",
                    )}
                  />
                </label>
              ))}
              {(
                [
                  ["retentionDays", "Retention days", 30, 36_500],
                  [
                    "checkpointIntervalMinutes",
                    "Checkpoint interval (minutes)",
                    1,
                    30,
                  ],
                  ["baseIntervalHours", "Full base interval (hours)", 1, 24],
                  [
                    "verificationIntervalDays",
                    "Verification interval (days)",
                    1,
                    30,
                  ],
                  [
                    "pauseLimitSeconds",
                    "Write pause maximum (seconds)",
                    1,
                    120,
                  ],
                ] as const
              ).map(([key, title, minimum, maximum]) => (
                <label
                  key={key}
                  className={cn("flex flex-col gap-2 text-subhead-regular")}
                >
                  {title}
                  <input
                    type="number"
                    min={minimum}
                    max={maximum}
                    required
                    value={draft[key]}
                    onChange={(event) => {
                      setDraft((value) => ({
                        ...value,
                        [key]: Number(event.target.value),
                      }));
                      setValidation(null);
                    }}
                    className={cn(
                      "rounded-lg border border-border bg-canvas px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent",
                    )}
                  />
                </label>
              ))}
            </fieldset>
            <label
              className={cn("flex items-start gap-3 text-subhead-regular")}
            >
              <input
                type="checkbox"
                disabled={busy}
                checked={draft.schedulingEnabled}
                onChange={(event) => {
                  setDraft((value) => ({
                    ...value,
                    schedulingEnabled: event.target.checked,
                  }));
                  setValidation(null);
                }}
                className={cn(
                  "mt-1 accent-accent focus-visible:outline-2 focus-visible:outline-accent",
                )}
              />
              <span>
                Enable scheduled protection after configuration, key recovery
                and the first complete restore drill validate.
              </span>
            </label>
            <p className={cn("text-subhead-regular text-fg-muted")}>
              Certified checkpoints: every {draft.checkpointIntervalMinutes}{" "}
              minutes. Full base: every {draft.baseIntervalHours} hours. Restore
              verification: every {draft.verificationIntervalDays} days. Write
              pause maximum: {draft.pauseLimitSeconds} seconds. Holds and
              stronger retention still apply.
            </p>
            <div className={cn("flex flex-wrap gap-3")}>
              <Button
                type="submit"
                variant="outline"
                tone="grey"
                disabled={busy}
              >
                {validationPending
                  ? "Retry validation"
                  : "Validate configuration"}
              </Button>
              <Button
                type="button"
                disabled={
                  busy ||
                  !validation?.valid ||
                  validated !== `${policyVersion}:${draftKey}`
                }
                onClick={() => {
                  void execute(async (signal, epoch) => {
                    const policy = await gateway.save(
                      instanceId,
                      policyBody(),
                      signal,
                    );
                    if (signal.aborted || epoch !== authorityEpoch.current)
                      return;
                    setSnapshot((value) =>
                      value ? { ...value, policy } : null,
                    );
                    setValidation(null);
                    setNotice(
                      "Configuration approved. Existing recovery chains remain retained.",
                    );
                  });
                }}
              >
                Approve configuration
              </Button>
            </div>
          </form>
          {validation ? (
            <section
              aria-label="Backup configuration validation"
              className={cn("text-subhead-regular")}
            >
              <h3 className={cn("text-subhead-semibold")}>
                {validation.valid
                  ? "Configuration validation passed"
                  : validationPending
                    ? "Runtime validation pending"
                    : "Configuration requires attention"}
              </h3>
              {validationPending ? (
                <p className={cn("mt-2 text-subhead-regular text-fg-muted")}>
                  The proposed configuration is awaiting executor checks. Retry
                  validation after the executor checks the mounted runtime.
                  Approval remains disabled until every required check passes.
                  No backup has started and scheduling has not been enabled.
                </p>
              ) : null}
              <ul className={cn("mt-2 list-disc space-y-1 pl-5")}>
                {validation.checks.map((check) => (
                  <li key={check.code}>
                    {check.code.replaceAll("_", " ")}: {check.status}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div>
            <Button
              disabled={busy || !snapshot.policy}
              onClick={() => {
                void execute(async (signal, epoch) => {
                  await gateway.run(
                    instanceId,
                    {
                      expectedVersion: policyVersion,
                      idempotencyKey: identity(`capture:${policyVersion}`),
                    },
                    signal,
                  );
                  if (signal.aborted || epoch !== authorityEpoch.current)
                    return;
                  setNotice(
                    "Encrypted backup requested. A certified result requires a complete integrity check.",
                  );
                  setAttempt((value) => value + 1);
                });
              }}
            >
              Run encrypted backup
            </Button>
          </div>
          <BackupsRuns
            items={snapshot.history.items}
            busy={busy}
            review={review}
            onAction={mutateRun}
          />
          {snapshot.history.nextCursor ? (
            <Button
              className={cn("self-start")}
              variant="outline"
              tone="grey"
              disabled={busy}
              onClick={() =>
                setCursor(snapshot.history.nextCursor ?? undefined)
              }
            >
              Next backup page
            </Button>
          ) : null}
          {cursor ? (
            <Button
              className={cn("self-start")}
              variant="outline"
              tone="grey"
              disabled={busy}
              onClick={() => setCursor(undefined)}
            >
              First backup page
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
