import type { MutableRefObject } from "react";

export type PendingAuditRequest = Readonly<{ key: string; requestId: string }>;

export function durableAuditRequestId(
  ref: MutableRefObject<PendingAuditRequest | null>,
  key: string,
  createRequestId: () => string,
): string {
  if (ref.current?.key === key) return ref.current.requestId;
  const next = createRequestId();
  ref.current = { key, requestId: next };
  return next;
}

export function clearDurableAuditRequestId(
  ref: MutableRefObject<PendingAuditRequest | null>,
  key: string,
) {
  if (ref.current?.key === key) ref.current = null;
}
