export type BackupControlAction =
  | "alerts/reconcile"
  | "policy/read"
  | "policy/validate"
  | "policy/validation-failed"
  | "policy/validated"
  | "policy/validation-read"
  | "policy/update"
  | "run/create"
  | "run/list"
  | "run/reconcile"
  | "run/read"
  | "run/cancel"
  | "run/claim"
  | "run/pause"
  | "run/heartbeat"
  | "run/complete"
  | "run/retry"
  | "run/fail"
  | "cleanup/request"
  | "cleanup/claim"
  | "cleanup/review"
  | "cleanup/authorize"
  | "cleanup/finish"
  | "schedule/enqueue";
export interface BackupControlPort {
  execute(
    instanceId: string,
    actor: string,
    action: BackupControlAction,
    input?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
