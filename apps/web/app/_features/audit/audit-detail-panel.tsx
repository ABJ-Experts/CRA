"use client";

import type { AuditDetail } from "@repo/contracts/audit/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalRoot,
  ModalTitle,
} from "@repo/ui/modal";
import { Tag, type TagProps } from "@repo/ui/tag";
import { ShieldAlert } from "lucide-react";

import type { AuditVerificationStatus } from "./audit-explorer";

type DetailQueryState = Readonly<{
  data: AuditDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}>;

export function verificationLabel(status: AuditVerificationStatus): string {
  switch (status) {
    case "event_hashes_checked":
      return "Event hashes checked";
    case "legacy_unchained":
      return "Legacy row";
    case "integrity_break":
      return "Integrity break";
    case "not_verified":
      return "Not verified";
  }
}

export function verificationTone(status: AuditVerificationStatus): TagProps["tone"] {
  if (status === "event_hashes_checked") return "green";
  if (status === "integrity_break") return "red";
  if (status === "legacy_unchained") return "orange";
  return "blue";
}

function DetailValue({
  label,
  value,
}: Readonly<{ label: string; value: unknown }>) {
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-surface p-3">
      <dt className="text-caption-1-semibold text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-caption-1-regular text-fg">
        {typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : value === null
            ? "None"
            : JSON.stringify(value, null, 2)}
      </dd>
    </div>
  );
}

export function AuditDetailPanel({
  open,
  detail,
  hasIntegrityBreak,
  onOpenChange,
  onCloseAutoFocus,
  errorText,
}: Readonly<{
  open: boolean;
  detail: DetailQueryState;
  hasIntegrityBreak: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  errorText: (error: unknown) => string;
}>) {
  return (
    <ModalRoot open={open} onOpenChange={onOpenChange}>
      <ModalContent
        size="lg"
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "fixed top-0 right-0 h-dvh max-h-dvh w-full max-w-full rounded-none rounded-l-xl",
          "sm:w-[min(42rem,calc(100vw-2rem))]",
          "data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
        )}
      >
        <ModalHeader>
          <ModalTitle>Audit event detail</ModalTitle>
          <ModalDescription>
            Redacted before and after values only. Hidden evidence is not exposed here.
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="grid content-start gap-4 py-2">
          {detail.isLoading ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              Loading event detail…
            </p>
          ) : null}
          {detail.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2">
              <span className="text-caption-1-regular text-danger">
                {errorText(detail.error)}
              </span>
              <Button variant="outline" tone="grey" onClick={() => void detail.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
          {detail.data ? (
            <>
              <div className="flex flex-wrap items-start gap-2">
                <Tag variant="dot" tone={verificationTone(detail.data.event.verificationStatus)}>
                  {verificationLabel(detail.data.event.verificationStatus)}
                </Tag>
                {detail.data.event.correlationId ? (
                  <Tag variant="cool">{detail.data.event.correlationId}</Tag>
                ) : null}
              </div>
              <dl className="grid gap-3 md:grid-cols-2">
                <DetailValue label="Actor" value={detail.data.event.actor.label ?? detail.data.event.actor.id} />
                <DetailValue label="Action" value={detail.data.event.action} />
                <DetailValue label="Resource type" value={detail.data.event.resourceType} />
                <DetailValue label="Resource" value={detail.data.event.resourceId} />
                <DetailValue label="Before redacted" value={detail.data.before} />
                <DetailValue label="After redacted" value={detail.data.after} />
                <DetailValue label="Reason" value={detail.data.reason} />
              </dl>
            </>
          ) : null}
        </ModalBody>
        <ModalFooter
          left={
            hasIntegrityBreak ? (
              <span className="inline-flex items-center gap-2 text-caption-1-regular text-danger">
                <ShieldAlert aria-hidden="true" className="size-4" />
                Integrity break in visible results
              </span>
            ) : null
          }
        >
          <ModalClose asChild>
            <Button variant="outline" tone="grey">
              Close
            </Button>
          </ModalClose>
        </ModalFooter>
      </ModalContent>
    </ModalRoot>
  );
}
